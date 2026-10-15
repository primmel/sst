// spawn-registry.ts — the registry DO: the /sims surface (spawn, list,
// retire) + the standing-sim definitions.
//
// An instance = (serial, physics). The custody rule: a serial is bound
// while a live sim (or a standing twin) holds it — a second binding is
// REFUSED (the failure branch the platform's stage machine models);
// retiring frees the serial. Minting draws from LC500-101..199 and never
// LC500-001/002 (the seeded custody).
//
// Persistence: the records live in THIS DO's storage (transactional,
// survives deploys/restarts) — the registry lists what it can prove;
// expired records are pruned on access and by alarm, and the serial
// frees.
//
// AUTH SHAPE: spawn/retire read SST_SPAWN_TOKEN — unset today (open,
// the demo posture); set it and the same routes demand
// `Authorization: Bearer <token>` with no API change.
//
// CAP: SST_MAX_CONCURRENT_SIMS (default 10) bounds the live
// non-standing sims; an over-cap spawn refuses honestly naming the cap
// (never silent reuse).

import type { SimStage } from './session-do.js'
import { libraryPhysicsProfiles } from './content.js'
import { corsOriginAllowed } from '@primmel/sst-runtime/server'

export const DEFAULT_TTL_S = 4 * 60 * 60        // 4h
export const MIN_TTL_S = 1                       // the honest lower bound (tests + demos)
export const MAX_TTL_S = 24 * 60 * 60            // 24h
export const DEFAULT_MAX_SIMS = 10
const SERIAL_FLOOR = 101                         // minting range LC500-101..199
const SERIAL_CEIL = 199
const SEEDED_SERIALS = ['LC500-001', 'LC500-002'] // the seeded custody — never minted

/** A live sim's registry record (the spawn's truth). */
export interface SimRecord {
  sim_id: string
  serial: string
  physics: string
  created_at: string
  expires_at: string
  standing: boolean
}

/** The standing twins: the canonical LC500-001 at the ROOT (the
 *  platform's seed binds it — the URL never moves) and LC500-002 (its
 *  sample-true physics, creep-fail) at /lc500-002. The root's DO name
 *  comes from SST_SESSION_ID (the seed contract's instance). */
export function standingSims(env: { SST_SESSION_ID?: string }): Array<SimRecord & { do_name: string; url_path: string }> {
  return [
    {
      sim_id: 'standing-lc500-001',
      serial: 'LC500-001',
      physics: 'fresh',
      created_at: '',
      expires_at: '',
      standing: true,
      do_name: env.SST_SESSION_ID ?? 'lc500-fresh',
      url_path: '/',
    },
    {
      sim_id: 'standing-lc500-002',
      serial: 'LC500-002',
      physics: 'creep-fail',
      created_at: '',
      expires_at: '',
      standing: true,
      do_name: 'standing-lc500-002|LC500-002|creep-fail',
      url_path: '/lc500-002',
    },
  ]
}

export interface SpawnRegistryEnv {
  SST_CORS_ORIGINS?: string | undefined
  SST_MAX_CONCURRENT_SIMS?: string | undefined
  SST_SPAWN_TOKEN?: string | undefined
  /** The root standing twin's DO id name (the seed contract's
   *  instance; default 'lc500-fresh'). */
  SST_SESSION_ID?: string | undefined
  /** The live sims' DO namespace (the spawner reaches them for state
   *  pulls + retirement). */
  SIM_SESSION: DurableObjectNamespace
}

interface SimRecordStored extends SimRecord {
  do_name: string
}

export class SimRegistry {
  readonly #state: DurableObjectState
  readonly #env: SpawnRegistryEnv

  constructor(state: DurableObjectState, env: SpawnRegistryEnv) {
    this.#state = state
    this.#env = env
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const origin = url.origin
    // ── CORS: the same list that gates the twin channels. ───────────
    const requestOrigin = request.headers.get('origin')
    const corsAllow = this.#env.SST_CORS_ORIGINS && requestOrigin
      ? this.#env.SST_CORS_ORIGINS === '*'
        ? '*'
        : corsOriginAllowed(this.#env.SST_CORS_ORIGINS, requestOrigin)
          ? requestOrigin
          : null
      : null
    const withCors = (res: Response): Response => {
      if (!corsAllow) return res
      const headers = new Headers(res.headers)
      headers.set('access-control-allow-origin', corsAllow)
      headers.set('vary', 'origin')
      return new Response(res.body, { status: res.status, statusText: res.statusText, headers })
    }
    if (request.method === 'OPTIONS') {
      if (corsAllow) {
        return new Response(null, {
          status: 204,
          headers: {
            'access-control-allow-origin': corsAllow,
            'vary': 'origin',
            'access-control-allow-methods': 'GET, POST, OPTIONS, DELETE',
            'access-control-allow-headers': 'content-type, authorization',
          },
        })
      }
      return new Response(null, { status: 403, headers: { 'content-type': 'text/plain' } })
    }

    if (url.pathname === '/sims' && request.method === 'POST') return withCors(await this.#spawn(request, origin))
    if (url.pathname === '/sims' && request.method === 'GET') return withCors(await this.#list(origin))
    // ── Internal: the spawned sims resolve their selection here at
    //    boot (the registry is the SSOT; a gone record fails the boot
    //    loudly). Not part of the public /sims surface.
    const selection = /^\/-\/selection\/([^/]+)$/.exec(url.pathname)
    if (selection && request.method === 'GET') {
      const record = await this.#state.storage.get(`sim:${decodeURIComponent(selection[1]!)}`) as SimRecordStored | undefined
      if (record == null) return Response.json({ error: 'no_such_sim' }, { status: 404 })
      return Response.json({ serial: record.serial, physics: record.physics })
    }
    const detail = /^\/sims\/([^/]+)$/.exec(url.pathname)
    if (detail) {
      const simId = decodeURIComponent(detail[1]!)
      if (request.method === 'GET') return withCors(await this.#detail(simId, origin))
      if (request.method === 'DELETE') return withCors(await this.#retire(simId, request))
    }
    return withCors(new Response('not found', { status: 404, headers: { 'content-type': 'text/plain' } }))
  }

  /** The expiry scan: prune what TTL passed (the alarm's job between
   *  accesses; every op prunes first). */
  async alarm(): Promise<void> {
    await this.#pruneExpired()
  }

  // ── POST /sims — spawn ────────────────────────────────────────────────

  async #spawn(request: Request, origin: string): Promise<Response> {
    const unauthorized = this.#requireSpawnAuth(request)
    if (unauthorized) return unauthorized

    let body: { serial?: unknown; physics?: unknown; ttl_seconds?: unknown } = {}
    try {
      body = await request.json() as typeof body
    } catch { /* an empty body is a legal default spawn */ }

    // physics: supply-or-default('fresh'), validated against the bundle.
    const physics = body.physics == null ? 'fresh' : String(body.physics)
    if (!libraryPhysicsProfiles().includes(physics)) {
      return Response.json({
        error: 'unknown_physics',
        physics,
        available: libraryPhysicsProfiles(),
      }, { status: 422 })
    }

    // ttl: clamped honestly; expires_at tells the truth.
    const requestedTtl = body.ttl_seconds == null ? DEFAULT_TTL_S : Number(body.ttl_seconds)
    if (!Number.isFinite(requestedTtl) || requestedTtl < MIN_TTL_S || requestedTtl > MAX_TTL_S) {
      return Response.json({
        error: 'ttl_out_of_range',
        ttl_seconds: body.ttl_seconds ?? null,
        accepted_range: { min: MIN_TTL_S, max: MAX_TTL_S },
      }, { status: 422 })
    }
    const expiresAt = new Date(Date.now() + requestedTtl * 1000)

    // serial: supply-or-mint (custody-guarded either way).
    await this.#pruneExpired()
    const bound = new Map<string, string>() // serial → sim_id (live + standing)
    for (const s of standingSims(this.#env)) bound.set(s.serial, s.sim_id)
    for (const rec of await this.#liveRecords()) bound.set(rec.serial, rec.sim_id)

    let serial: string
    if (body.serial == null) {
      const minted = this.#mintSerial(bound)
      if (minted == null) {
        return Response.json({ error: 'serial_exhausted', range: `LC500-${SERIAL_FLOOR}..LC500-${SERIAL_CEIL}` }, { status: 507 })
      }
      serial = minted
    } else {
      serial = String(body.serial)
      if (!/^LC500-\d{3}$/.test(serial)) {
        return Response.json({ error: 'bad_serial', serial, expected: 'LC500-<3 digits>' }, { status: 422 })
      }
      const holder = bound.get(serial)
      if (holder != null) {
        // The custody guard: a serial binds once. (The refusal IS the
        // same-serial-different-physics failure branch the platform's
        // stage machine models.)
        return Response.json({ error: 'serial_already_bound', serial, held_by: holder }, { status: 409 })
      }
    }

    // cap: live non-standing sims (the standing twins never count).
    const cap = this.#cap()
    const live = (await this.#liveRecords()).length
    if (live >= cap) {
      return Response.json({
        error: 'sim_cap_reached',
        cap,
        live,
        message: `the deployment allows ${cap} concurrent spawned sims — retire one (DELETE /sims/:sim_id) and spawn again`,
      }, { status: 429 })
    }

    const simId = `sim-${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`
    const record: SimRecordStored = {
      sim_id: simId,
      serial,
      physics,
      created_at: new Date().toISOString(),
      expires_at: expiresAt.toISOString(),
      standing: false,
      do_name: `spawned:${simId}`,
    }
    await this.#state.storage.put(`sim:${simId}`, record)
    await this.#armAlarm()

    return Response.json(spawnView(record, origin), { status: 201 })
  }

  // ── GET /sims — the live registry (standing sims included) ───────────

  async #list(origin: string): Promise<Response> {
    await this.#pruneExpired()
    const records = await this.#liveRecords()
    const sims = await Promise.all([
      ...standingSims(this.#env).map(async (s) => registryView(s, origin, await this.#pullState(s.do_name))),
      ...records.map(async (r) => registryView(r, origin, await this.#pullState(r.do_name))),
    ])
    return Response.json({
      sims,
      cap: this.#cap(),
      live: records.length,
    })
  }

  async #detail(simId: string, origin: string): Promise<Response> {
    await this.#pruneExpired()
    const standing = standingSims(this.#env).find((s) => s.sim_id === simId)
    const record = standing ?? (await this.#liveRecords()).find((r) => r.sim_id === simId)
    if (record == null) {
      return Response.json({ error: 'no_such_sim', sim_id: simId }, { status: 404 })
    }
    return Response.json(registryView(record, origin, await this.#pullState(record.do_name)))
  }

  // ── DELETE /sims/:id — retire (frees the serial) ──────────────────────

  async #retire(simId: string, request: Request): Promise<Response> {
    const unauthorized = this.#requireSpawnAuth(request)
    if (unauthorized) return unauthorized
    await this.#pruneExpired()

    const standing = standingSims(this.#env).find((s) => s.sim_id === simId)
    if (standing != null) {
      return Response.json({
        error: 'standing_sim',
        sim_id: simId,
        message: `the standing twin '${standing.serial}' is part of the deployment — it cannot be retired`,
      }, { status: 403 })
    }
    const key = `sim:${simId}`
    const record = await this.#state.storage.get(key) as SimRecordStored | undefined
    if (record == null) {
      return Response.json({ error: 'no_such_sim', sim_id: simId }, { status: 404 })
    }
    // Retire the DO's in-memory state best-effort, then drop the record
    // (the serial frees; the DO name is unique and never reused).
    try {
      await this.#simStub(record.do_name).fetch('https://registry.internal/-/retire', { method: 'POST' })
    } catch { /* an unreachable DO is already gone */ }
    await this.#state.storage.delete(key)
    await this.#armAlarm()
    return Response.json({ retired: true, sim_id: simId, serial: record.serial, freed: true })
  }

  // ── internals ─────────────────────────────────────────────────────────

  /** The spawn/retire auth (the SST_SPAWN_TOKEN face): unset → open.
   *  Setting the env gates WITHOUT an API change — the same routes
   *  start demanding `Authorization: Bearer <token>`. */
  #requireSpawnAuth(request: Request): Response | null {
    const token = this.#env.SST_SPAWN_TOKEN
    if (token == null) return null
    const header = request.headers.get('authorization')
    if (header === `Bearer ${token}`) return null
    return Response.json(
      { error: 'unauthorized', message: 'spawn/retire require Authorization: Bearer <token> (SST_SPAWN_TOKEN is set on this deployment)' },
      { status: 401 },
    )
  }

  #cap(): number {
    const raw = Number(this.#env.SST_MAX_CONCURRENT_SIMS ?? DEFAULT_MAX_SIMS)
    return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_MAX_SIMS
  }

  #mintSerial(bound: Map<string, string>): string | null {
    for (let n = SERIAL_FLOOR; n <= SERIAL_CEIL; n++) {
      const serial = `LC500-${String(n).padStart(3, '0')}`
      if (SEEDED_SERIALS.includes(serial)) continue // never 001/002
      if (!bound.has(serial)) return serial
    }
    return null
  }

  async #liveRecords(): Promise<SimRecordStored[]> {
    const map = await this.#state.storage.list({ prefix: 'sim:' })
    return [...map.values()] as SimRecordStored[]
  }

  async #pruneExpired(): Promise<void> {
    const now = Date.now()
    const map = await this.#state.storage.list({ prefix: 'sim:' })
    for (const [key, value] of map) {
      const rec = value as SimRecordStored
      if (Date.parse(rec.expires_at) <= now) {
        // Retire the DO's in-memory state best-effort, then drop the
        // record (the serial frees).
        try {
          await this.#simStub(rec.do_name).fetch('https://registry.internal/-/retire', { method: 'POST' })
        } catch { /* an unreachable DO is already gone */ }
        await this.#state.storage.delete(key)
      }
    }
    await this.#armAlarm()
  }

  async #armAlarm(): Promise<void> {
    const map = await this.#state.storage.list({ prefix: 'sim:' })
    let earliest: number | null = null
    for (const value of map.values()) {
      const at = Date.parse((value as SimRecordStored).expires_at)
      if (Number.isFinite(at) && (earliest == null || at < earliest)) earliest = at
    }
    if (earliest != null) await this.#state.storage.setAlarm(earliest + 1)
    else await this.#state.storage.deleteAlarm()
  }

  async #pullState(doName: string): Promise<SimStage> {
    try {
      const res = await this.#simStub(doName).fetch('https://registry.internal/-/state')
      if (res.ok) {
        const body = await res.json() as { state?: SimStage }
        if (body.state != null) return body.state
      }
    } catch { /* unreachable → idle (the registry lists what it can prove) */ }
    return 'idle'
  }

  #simStub(doName: string): DurableObjectStub {
    return this.#env.SIM_SESSION.get(this.#env.SIM_SESSION.idFromName(doName))
  }
}

/** The spawn response / record view (the platform's twin binding
 *  consumes `url` as base_url). */
function spawnView(rec: SimRecord, origin: string): Record<string, unknown> {
  const url = `${origin}/sims/${rec.sim_id}`
  return {
    sim_id: rec.sim_id,
    serial: rec.serial,
    physics: rec.physics,
    url,
    world_console_url: `${url}/world`,
    expires_at: rec.expires_at,
    standing: rec.standing,
  }
}

/** The registry view (GET /sims + GET /sims/:id). */
function registryView(rec: SimRecord & { url_path?: string }, origin: string, state: SimStage): Record<string, unknown> {
  const url = rec.standing && rec.url_path != null
    ? `${origin}${rec.url_path}`
    : `${origin}/sims/${rec.sim_id}`
  return {
    sim_id: rec.sim_id,
    serial: rec.serial,
    physics: rec.physics,
    state,
    url,
    world_console_url: `${url.replace(/\/$/, '')}/world`,
    expires_at: rec.expires_at || null,
    standing: rec.standing,
  }
}
