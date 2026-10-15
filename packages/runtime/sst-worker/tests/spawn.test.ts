// tests/spawn.test.ts — the spawner surface, exercised through the
// worker entry with in-memory DO namespaces: spawn → registry → the
// per-sim URL answering the MINTED serial → readings → retire; the cap
// refusal; the custody guard; the standing twins; the root contract
// unchanged.

import { describe, it, expect } from 'vitest'
import worker, { type Env } from '../src/index.js'
import { SimSession, type SimSessionEnv } from '../src/session-do.js'
import { SimRegistry } from '../src/spawn-registry.js'
import { syntheticBundle } from './lib.js'

const ORIGIN = 'https://demo.example'
const STAGING = 'https://staging-demo.oimlsmart.org'

// ── The in-memory DO fabric (DO semantics: one instance per name) ─────

function memoryState(name: string): DurableObjectState {
  const map = new Map<string, unknown>()
  return {
    id: { name },
    storage: {
      async get(k: string) { return map.get(k) },
      async put(k: string, v: unknown) { map.set(k, v) },
      async delete(k: string) { return map.delete(k) },
      async list(opts: { prefix?: string }) {
        const out = new Map<string, unknown>()
        for (const [k, v] of map) if (!opts.prefix || k.startsWith(opts.prefix)) out.set(k, v)
        return out
      },
      async setAlarm(_t: number) { /* bookkeeping only in these tests */ },
      async getAlarm() { return null },
      async deleteAlarm() { /* bookkeeping only in these tests */ },
    },
  } as unknown as DurableObjectState
}

function fakeNamespace(cls: new (...args: never[]) => { fetch(r: Request): Promise<Response> }, env: Record<string, unknown>): DurableObjectNamespace {
  const instances = new Map<string, { fetch(r: Request): Promise<Response> }>()
  return {
    idFromName: (name: string) => ({ name, toString: () => name }) as unknown as DurableObjectId,
    get: (id: DurableObjectId) => {
      const doName = id.name ?? id.toString()
      let inst = instances.get(doName)
      if (inst == null) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        inst = new (cls as any)(memoryState(doName), env) as { fetch(r: Request): Promise<Response> }
        instances.set(doName, inst)
      }
      return { fetch: (r: Request | string) => inst!.fetch(new Request(r)) } as unknown as DurableObjectStub
    },
    newUniqueId: () => { throw new Error('not needed in tests') },
    idFromString: () => { throw new Error('not needed in tests') },
  } as unknown as DurableObjectNamespace
}

/** The full deployment fabric: the entry + both namespaces over the
 *  synthetic bundle (the loader honors the physics selection). */
function fabric(extraEnv: Record<string, string> = {}): { env: Env; fetch(path: string, init?: RequestInit): Promise<Response> } {
  class TestSimSession extends SimSession {
    constructor(state: DurableObjectState, e: Record<string, unknown>) {
      super(state, e as SimSessionEnv, (select) => syntheticBundle(select))
    }
  }
  const env = {
    SST_CORS_ORIGINS: STAGING,
    SST_MAX_CONCURRENT_SIMS: '2',
    SST_SESSION_IDLE_S: '1800',
    ...extraEnv,
  } as unknown as Record<string, unknown>
  const simNs = fakeNamespace(TestSimSession as unknown as new (...args: never[]) => { fetch(r: Request): Promise<Response> }, env)
  const registryNs = fakeNamespace(SimRegistry as unknown as new (...args: never[]) => { fetch(r: Request): Promise<Response> }, env)
  env.SIM_SESSION = simNs
  env.SIM_REGISTRY = registryNs
  const envTyped = env as unknown as Env
  return {
    env: envTyped,
    fetch: (path: string, init?: RequestInit) =>
      worker.fetch(new Request(new URL(path, ORIGIN), init), envTyped),
  }
}

interface SimView {
  sim_id: string
  serial: string
  physics: string
  state: string
  url: string
  world_console_url: string
  expires_at: string | null
  standing: boolean
}

async function spawn(f: ReturnType<typeof fabric>, body: Record<string, unknown> = {}, status = 201): Promise<SimView> {
  const res = await f.fetch('/sims', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: STAGING },
    body: JSON.stringify(body),
  })
  expect(res.status).toBe(status)
  return await res.json() as SimView
}

async function listSims(f: ReturnType<typeof fabric>): Promise<{ sims: SimView[]; cap: number; live: number }> {
  const res = await f.fetch('/sims', { headers: { origin: STAGING } })
  expect(res.status).toBe(200)
  return await res.json() as { sims: SimView[]; cap: number; live: number }
}

describe('POST /sims — spawn', () => {
  it('mints serial+physics, returns the binding shape, answers the minted identity', async () => {
    const f = fabric()
    const sim = await spawn(f, { physics: 'creep-fail' })
    expect(sim.sim_id).toMatch(/^sim-[0-9a-f]{12}$/)
    expect(sim.serial).toMatch(/^LC500-1\d\d$/)
    const n = Number(sim.serial.slice('LC500-'.length))
    expect(n).toBeGreaterThanOrEqual(101)
    expect(n).toBeLessThanOrEqual(199)
    expect(sim.physics).toBe('creep-fail')
    expect(sim.url).toBe(`${ORIGIN}/sims/${sim.sim_id}`)
    expect(sim.world_console_url).toBe(`${ORIGIN}/sims/${sim.sim_id}/world`)
    expect(sim.standing).toBe(false)
    expect(new Date(sim.expires_at ?? '0').getTime()).toBeGreaterThan(Date.now() + 3 * 60 * 60 * 1000)

    // The per-sim base URL answers /twin with the MINTED serial (not
    // the sample's LC500-002) — the identity minted at spawn.
    const identity = await (await f.fetch(`/sims/${sim.sim_id}/twin/instrument`)).json() as { identification: { serial: string } }
    expect(identity.identification.serial).toBe(sim.serial)

    // And the root twin is NOT disturbed (in the fabric the standing
    // root answers the synthetic bundle's sample serial).
    const root = await (await f.fetch('/twin/instrument')).json() as typeof identity
    expect(root.identification.serial).toBe('SYN-001')
  })

  it('honors a supplied serial (custody-guarded) and the ttl', async () => {
    const f = fabric()
    const sim = await spawn(f, { serial: 'LC500-155', ttl_seconds: 3600 })
    expect(sim.serial).toBe('LC500-155')
    const ttlMs = new Date(sim.expires_at ?? '0').getTime() - Date.now()
    expect(ttlMs).toBeGreaterThan(55 * 60 * 1000)
    const identity = await (await f.fetch(`/sims/${sim.sim_id}/twin/instrument`)).json() as { identification: { serial: string } }
    expect(identity.identification.serial).toBe('LC500-155')
  })

  it('refuses an unknown physics naming the available profiles', async () => {
    const f = fabric()
    const res = await f.fetch('/sims', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: STAGING },
      body: JSON.stringify({ physics: 'turbo-encabulator' }),
    })
    expect(res.status).toBe(422)
    const body = await res.json() as { error: string; available: string[] }
    expect(body.error).toBe('unknown_physics')
    expect(body.available).toContain('fresh')
  })

  it('refuses an out-of-range ttl naming the accepted range', async () => {
    const f = fabric()
    const res = await f.fetch('/sims', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: STAGING },
      body: JSON.stringify({ ttl_seconds: 999999 }),
    })
    expect(res.status).toBe(422)
    expect(((await res.json()) as { error: string }).error).toBe('ttl_out_of_range')
  })

  it('the custody guard: a bound serial (standing or spawned) never re-binds', async () => {
    const f = fabric()
    // The seeded standing serial.
    const seeded = await f.fetch('/sims', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: STAGING },
      body: JSON.stringify({ serial: 'LC500-001' }),
    })
    expect(seeded.status).toBe(409)
    const seededBody = await seeded.json() as { error: string; serial: string; held_by: string }
    expect(seededBody.held_by).toBe('standing-lc500-001')

    // A spawned serial while its sim is live.
    const sim = await spawn(f, { serial: 'LC500-160' })
    const again = await f.fetch('/sims', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: STAGING },
      body: JSON.stringify({ serial: 'LC500-160' }),
    })
    expect(again.status).toBe(409)
    expect(((await again.json()) as { held_by: string }).held_by).toBe(sim.sim_id)
  })

  it('minting never draws the seeded custody (LC500-001/002)', async () => {
    const f = fabric({ SST_MAX_CONCURRENT_SIMS: '5' })
    for (let i = 0; i < 3; i++) {
      const sim = await spawn(f)
      expect(['LC500-001', 'LC500-002']).not.toContain(sim.serial)
    }
  })

  it('the cap: an over-cap spawn refuses honestly naming the cap', async () => {
    const f = fabric({ SST_MAX_CONCURRENT_SIMS: '2' })
    await spawn(f)
    await spawn(f)
    const third = await f.fetch('/sims', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: STAGING },
      body: JSON.stringify({}),
    })
    expect(third.status).toBe(429)
    const body = await third.json() as { error: string; cap: number; live: number; message: string }
    expect(body.error).toBe('sim_cap_reached')
    expect(body.cap).toBe(2)
    expect(body.live).toBe(2)
    expect(body.message).toMatch(/retire one/)
  })
})

describe('GET /sims — the live registry', () => {
  it('lists the standing twins first, marked standing, with the root URL for LC500-001', async () => {
    const f = fabric()
    const { sims } = await listSims(f)
    const one = sims.find((s) => s.serial === 'LC500-001')
    const two = sims.find((s) => s.serial === 'LC500-002')
    expect(one?.standing).toBe(true)
    expect(one?.url).toBe(`${ORIGIN}/`)
    expect(one?.physics).toBe('fresh')
    expect(two?.standing).toBe(true)
    expect(two?.url).toBe(`${ORIGIN}/lc500-002`)
    expect(two?.physics).toBe('creep-fail')
  })

  it('the stage state follows the platform stage machine (idle → connected → calibrated → running)', async () => {
    const f = fabric()
    const sim = await spawn(f)
    expect(((await listSims(f)).sims.find((s) => s.sim_id === sim.sim_id))?.state).toBe('idle')

    // Connect: a twin identity read.
    await f.fetch(`/sims/${sim.sim_id}/twin/instrument`)
    expect(((await listSims(f)).sims.find((s) => s.sim_id === sim.sim_id))?.state).toBe('connected')

    // Calibrate: a /world mutation.
    await f.fetch(`/sims/${sim.sim_id}/world`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: 'mutation { placeLoad(massKg: 40) { groundTruth { appliedLoadKg } } }' }),
    })
    expect(((await listSims(f)).sims.find((s) => s.sim_id === sim.sim_id))?.state).toBe('calibrated')

    // Start: the clock runs.
    await f.fetch(`/sims/${sim.sim_id}/world`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: 'mutation { advanceTime(seconds: 5) { clock } }' }),
    })
    expect(((await listSims(f)).sims.find((s) => s.sim_id === sim.sim_id))?.state).toBe('running')

    // The reading on the sim reflects the mutation (the per-sim physics
    // is live and isolated from the standing twins).
    const reading = await (await f.fetch(`/sims/${sim.sim_id}/twin/registers/indication`)).json() as { value: number }
    expect(reading.value).toBe(40)
    expect(((await listSims(f)).sims.find((s) => s.serial === 'LC500-001'))?.state).toBe('idle')
  })
})

describe('DELETE /sims/:id — retire', () => {
  it('retires a spawned sim, frees the serial, and refuses the standing twins', async () => {
    const f = fabric()
    const sim = await spawn(f, { serial: 'LC500-170' })

    const standing = await f.fetch('/sims/standing-lc500-001', { method: 'DELETE', headers: { origin: STAGING } })
    expect(standing.status).toBe(403)

    const del = await f.fetch(`/sims/${sim.sim_id}`, { method: 'DELETE', headers: { origin: STAGING } })
    expect(del.status).toBe(200)
    expect(((await del.json()) as { retired: boolean; serial: string }).serial).toBe('LC500-170')

    // Gone from the registry; the serial frees.
    const { sims } = await listSims(f)
    expect(sims.find((s) => s.sim_id === sim.sim_id)).toBeUndefined()
    const rebound = await spawn(f, { serial: 'LC500-170' })
    expect(rebound.sim_id).not.toBe(sim.sim_id)

    // The retired sim's DO no longer answers its surface (its record is
    // gone → a cold boot fails loudly; the in-memory state was retired).
    const afterRetire = await f.fetch(`/sims/${sim.sim_id}/twin/instrument`)
    expect(afterRetire.status).toBeGreaterThanOrEqual(500)
  })

  it('GET /sims/:id answers the record; unknown ids answer 404', async () => {
    const f = fabric()
    const sim = await spawn(f)
    const detail = await (await f.fetch(`/sims/${sim.sim_id}`, { headers: { origin: STAGING } })).json() as SimView
    expect(detail.serial).toBe(sim.serial)
    expect((await f.fetch('/sims/sim-nope', { headers: { origin: STAGING } })).status).toBe(404)
  })
})

describe('CORS + auth shape on /sims', () => {
  it('the spawn API carries the same CORS posture as the twin channels', async () => {
    const f = fabric()
    const pre = await f.fetch('/sims', { method: 'OPTIONS', headers: { origin: STAGING, 'access-control-request-method': 'POST' } })
    expect(pre.status).toBe(204)
    expect(pre.headers.get('access-control-allow-origin')).toBe(STAGING)
    expect(pre.headers.get('access-control-allow-methods')).toContain('DELETE')

    const foreign = await f.fetch('/sims', { method: 'OPTIONS', headers: { origin: 'https://evil.example', 'access-control-request-method': 'POST' } })
    expect(foreign.status).toBe(403)

    const posted = await spawn(f)
    const echo = await f.fetch('/sims', { headers: { origin: STAGING } })
    expect(echo.headers.get('access-control-allow-origin')).toBe(STAGING)
    void posted
  })

  it('SST_SPAWN_TOKEN gates spawn/retire without an API break', async () => {
    const f = fabric({ SST_SPAWN_TOKEN: 'secret-token' })
    const denied = await f.fetch('/sims', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: STAGING },
      body: JSON.stringify({}),
    })
    expect(denied.status).toBe(401)

    const allowed = await f.fetch('/sims', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: STAGING, authorization: 'Bearer secret-token' },
      body: JSON.stringify({}),
    })
    expect(allowed.status).toBe(201)
    const sim = await allowed.json() as SimView

    const deniedDelete = await f.fetch(`/sims/${sim.sim_id}`, { method: 'DELETE', headers: { origin: STAGING } })
    expect(deniedDelete.status).toBe(401)
    const allowedDelete = await f.fetch(`/sims/${sim.sim_id}`, { method: 'DELETE', headers: { origin: STAGING, authorization: 'Bearer secret-token' } })
    expect(allowedDelete.status).toBe(200)
  })
})

describe('expiry', () => {
  it('an expired sim vanishes from the registry and its serial frees', async () => {
    const f = fabric()
    const sim = await spawn(f, { serial: 'LC500-180', ttl_seconds: 1 })
    await new Promise((r) => setTimeout(r, 1200))
    const { sims } = await listSims(f)
    expect(sims.find((s) => s.sim_id === sim.sim_id)).toBeUndefined()
    const rebound = await spawn(f, { serial: 'LC500-180' })
    expect(rebound.serial).toBe('LC500-180')
  }, 15_000)
})

describe('the standing twins', () => {
  it('LC500-002 answers at /lc500-002 with its sample-true physics', async () => {
    const f = fabric()
    const identity = await (await f.fetch('/lc500-002/twin/instrument')).json() as { identification: { serial: string } }
    expect(identity.identification.serial).toBe('LC500-002')
    // Its world channel works (isolated from the root twin).
    const load = await f.fetch('/lc500-002/world', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: 'mutation { placeLoad(massKg: 10) { groundTruth { appliedLoadKg } } }' }),
    })
    expect(((await load.json()) as { data: { placeLoad: { groundTruth: { appliedLoadKg: number } } } }).data.placeLoad.groundTruth.appliedLoadKg).toBe(10)
    // The root twin stays untouched (in the fabric the standing root
    // answers the synthetic bundle's sample serial).
    const root = await (await f.fetch('/twin/instrument')).json() as { identification: { serial: string } }
    expect(root.identification.serial).toBe('SYN-001')
  })

  it('the root URL contract is unchanged: the landing, both channels, CORS', async () => {
    const f = fabric()
    // (spawn noise first — the root must not care)
    await spawn(f)
    const landing = await f.fetch('/')
    expect(landing.status).toBe(200)
    expect(await landing.text()).toContain('/twin')
    const world = await f.fetch('/world', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: 'mutation { placeLoad(massKg: 1) { groundTruth { appliedLoadKg } } }' }),
    })
    expect(world.status).toBe(200)
    const pre = await f.fetch('/world', { method: 'OPTIONS', headers: { origin: STAGING, 'access-control-request-method': 'POST' } })
    expect(pre.status).toBe(204)
  })
})
