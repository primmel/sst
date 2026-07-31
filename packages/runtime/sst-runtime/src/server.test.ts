import { describe, it, expect, afterEach } from 'vitest'
import { createSimServer } from './server.js'
import { buildWorldSchema, type WorldContext } from './world-schema.js'
import { VirtualClock } from './time.js'
import { SimulatedInstrument } from './instrument.js'
import { getScenario } from './scenario.js'

let close: (() => Promise<void>) | undefined
afterEach(async () => { await close?.(); close = undefined })

function boot() {
  const clock = new VirtualClock()
  const host: WorldContext = {
    instrument: new SimulatedInstrument(getScenario('good-cell'), clock, 1),
    clock,
    swap(def) { this.instrument = new SimulatedInstrument(def, clock, 1) },
  }
  return { host }
}

describe('createSimServer (spec §3/§9: one process, both channels + landing)', () => {
  it('serves /world over real HTTP (ephemeral port)', async () => {
    const { host } = boot()
    const server = await createSimServer({ worldSchema: buildWorldSchema(host), port: 0 })
    close = server.close
    const res = await fetch(`${server.url}/world`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: `mutation { placeLoad(massKg: 40) { groundTruth { appliedLoadKg } } }` }),
    })
    const body = await res.json() as { data: { placeLoad: { groundTruth: { appliedLoadKg: number } } } }
    expect(body.data.placeLoad.groundTruth.appliedLoadKg).toBe(40)
  })

  it('serves the GraphiQL playground for /world and /twin', async () => {
    const { host } = boot()
    const server = await createSimServer({ worldSchema: buildWorldSchema(host), port: 0 })
    close = server.close
    const w = await fetch(`${server.url}/world`, { headers: { accept: 'text/html' } })
    expect(w.status).toBe(200)
    expect(await w.text()).toContain('GraphiQL')
    const t = await fetch(`${server.url}/twin`, { headers: { accept: 'text/html' } })
    expect(t.status).toBe(200)
  })

  it('/ serves the landing page linking both channels', async () => {
    const { host } = boot()
    const server = await createSimServer({ worldSchema: buildWorldSchema(host), port: 0 })
    close = server.close
    const res = await fetch(`${server.url}/`)
    expect(res.status).toBe(200)
    const html = await res.text()
    expect(html).toContain('/world')
    expect(html).toContain('/twin')
  })

  it('/twin without a baked schema answers a clear placeholder, never a crash', async () => {
    const { host } = boot()
    const server = await createSimServer({ worldSchema: buildWorldSchema(host), port: 0 })
    close = server.close
    // introspection succeeds (the schema is honestly empty apart from the placeholder)
    const intro = await fetch(`${server.url}/twin`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: `{ __schema { queryType { fields { name } } } }` }),
    })
    expect(intro.status).toBe(200)
    // and the placeholder field explains itself when queried
    const res = await fetch(`${server.url}/twin`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: `{ _twinPlaceholder }` }),
    })
    expect(res.status).toBeLessThan(500)
    const body = await res.json() as { errors?: Array<{ message: string }> }
    expect(JSON.stringify(body)).toMatch(/twin schema not (generated|baked)/)
  })
})

describe('/world token guard (TODO.v2/11: opt-in bearer on mutations; queries + /twin stay open)', () => {
  const TOKEN = 's3cret-world-token'
  // every mutation kind of the load-cell /world surface (core + kind)
  const MUTATIONS: Array<[string, string]> = [
    ['placeLoad', `mutation { placeLoad(massKg: 40) { clock } }`],
    ['removeLoad', `mutation { removeLoad { clock } }`],
    ['setEnvironment', `mutation { setEnvironment(conditions: { temperatureDegC: 40 }) { clock } }`],
    ['playProfile', `mutation { playProfile(profile: "damp-heat-cyclic-db") { clock } }`],
    ['advanceTime', `mutation { advanceTime(seconds: 5) { clock } }`],
    ['setClockMode', `mutation { setClockMode(mode: "manual") { clock } }`],
    ['scenario', `mutation { scenario(name: "creep-cell") { clock } }`],
    ['injectFault', `mutation { injectFault { clock } }`],
    ['clearFault', `mutation { clearFault { clock } }`],
    ['reset', `mutation { reset { clock } }`],
    ['setFidelity', `mutation { setFidelity(servedOffsetKg: 0.1) { clock } }`],
    ['setThermalHysteresis', `mutation { setThermalHysteresis(perDegC: 0.0001) { clock } }`],
  ]

  async function guarded() {
    const { host } = boot()
    const server = await createSimServer({ worldSchema: buildWorldSchema(host), port: 0, worldToken: TOKEN })
    close = server.close
    return server
  }
  const post = (url: string, body: unknown, token?: string) =>
    fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(token !== undefined ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    })

  it('rejects every mutation kind without the token (401 + a clear error), and nothing executes', async () => {
    const server = await guarded()
    for (const [kind, query] of MUTATIONS) {
      const res = await post(`${server.url}/world`, { query })
      expect(res.status, kind).toBe(401)
      const body = await res.json() as { errors: Array<{ message: string; extensions: { code: string } }> }
      expect(body.errors[0]!.message, kind).toMatch(/unauthorized: \/world mutations require Authorization: Bearer/)
      expect(body.errors[0]!.extensions.code, kind).toBe('UNAUTHORIZED')
    }
    // the rejections were pre-execution: the world is untouched
    const res = await post(`${server.url}/world`, { query: `{ groundTruth { appliedLoadKg } worldState { clock } }` })
    const body = await res.json() as { data: { groundTruth: { appliedLoadKg: number }; worldState: { clock: number } } }
    expect(body.data.groundTruth.appliedLoadKg).toBe(0)
    expect(body.data.worldState.clock).toBe(0)
  })

  it('rejects a wrong token and a malformed header', async () => {
    const server = await guarded()
    const query = `mutation { placeLoad(massKg: 40) { clock } }`
    expect((await post(`${server.url}/world`, { query }, 'wrong-token')).status).toBe(401)
    const malformed = await fetch(`${server.url}/world`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: TOKEN }, // the scheme is missing
      body: JSON.stringify({ query }),
    })
    expect(malformed.status).toBe(401)
  })

  it('accepts the bearer token — the mutation executes', async () => {
    const server = await guarded()
    const res = await post(`${server.url}/world`, { query: `mutation { placeLoad(massKg: 40) { groundTruth { appliedLoadKg } } }` }, TOKEN)
    expect(res.status).toBe(200)
    const body = await res.json() as { data: { placeLoad: { groundTruth: { appliedLoadKg: number } } } }
    expect(body.data.placeLoad.groundTruth.appliedLoadKg).toBe(40)
  })

  it('leaves world queries open without the token (incl. introspection)', async () => {
    const server = await guarded()
    for (const query of [
      `{ groundTruth { appliedLoadKg } }`,
      `{ worldState { clock mode } }`,
      `{ scenarios { name } profiles { id } }`,
      `{ __schema { mutationType { fields { name } } } }`,
    ]) {
      const res = await post(`${server.url}/world`, { query })
      expect(res.status, query).toBe(200)
      const body = await res.json() as { data?: unknown }
      expect(body.data, query).toBeDefined()
    }
  })

  it('discriminates by operationName: a named query passes, the named mutation is rejected', async () => {
    const server = await guarded()
    const document = `query Peek { worldState { clock } } mutation Act { placeLoad(massKg: 40) { clock } }`
    const peek = await post(`${server.url}/world`, { query: document, operationName: 'Peek' })
    expect(peek.status).toBe(200)
    const act = await post(`${server.url}/world`, { query: document, operationName: 'Act' })
    expect(act.status).toBe(401)
  })

  it('leaves /twin fully open without the token', async () => {
    const server = await guarded() // no twinSchema → the honest placeholder
    const res = await post(`${server.url}/twin`, { query: `{ _twinPlaceholder }` })
    expect(res.status).toBe(200)
    const body = await res.json() as { errors?: Array<{ message: string }> }
    expect(JSON.stringify(body)).toMatch(/twin schema not (generated|baked)/)
  })

  it('still serves the GraphiQL playgrounds without the token', async () => {
    const server = await guarded()
    const w = await fetch(`${server.url}/world`, { headers: { accept: 'text/html' } })
    expect(w.status).toBe(200)
    expect(await w.text()).toContain('GraphiQL')
  })

  it('unguarded mode is unchanged: mutations pass with no header at all', async () => {
    const { host } = boot()
    const server = await createSimServer({ worldSchema: buildWorldSchema(host), port: 0 })
    close = server.close
    const res = await post(`${server.url}/world`, { query: `mutation { placeLoad(massKg: 40) { groundTruth { appliedLoadKg } } }` })
    expect(res.status).toBe(200)
    const body = await res.json() as { data: { placeLoad: { groundTruth: { appliedLoadKg: number } } } }
    expect(body.data.placeLoad.groundTruth.appliedLoadKg).toBe(40)
  })
})
