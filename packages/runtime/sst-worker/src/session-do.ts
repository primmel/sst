// session-do.ts — the Durable Object holding one simulation session.
//
// One DO instance per simulation session: the connect handshake, the
// calibration, the evolving physics, the served signatures — all
// in-memory DO state (single-threaded, like the node server's one
// process). The lifecycle is honest: an idle session's alarm drops the
// in-memory state, and the next request boots a fresh session (the
// platform's Connect stage re-establishes; the physics is seeded and
// deterministic, so a fresh boot replays the same instrument).
//
// Spawned sessions: the DO's NAME carries the selection —
//   '<sim_id>|<serial>|<physics>'
// (validated at spawn; never contains '|'). The standing twins are
// nameless DOs (no '|') and boot the default bundle exactly as before.

import {
  bootBundleSession,
  type BundleSession,
  type SessionBundle,
} from '@primmel/sst-runtime/session/boot-bundle'
import { createSessionHandler, type SessionHandler } from './worker-core.js'

/** The idle lifetime of a session (seconds) — the SST_SESSION_IDLE_S
 *  var, default 30 minutes. */
export const DEFAULT_IDLE_S = 1800

/** The deployment env the session reads — the WRANGLER var names (the
 *  node bins read the same names from process.env). */
export interface SimSessionEnv {
  /** CORS origins for browser clients (comma-separated or '*'). */
  SST_CORS_ORIGINS?: string | undefined
  /** Bearer token guarding /world mutations. */
  SIM_WORLD_TOKEN?: string | undefined
  /** '1'/'true' → the manifest's `signing:` block activates (the
   *  bundle-native face of the node bins' SST_SIGNED_SERVE env). */
  SST_SIGNED_SERVE?: string | undefined
  /** Session idle lifetime in seconds (default 1800). */
  SST_SESSION_IDLE_S?: string | undefined
  /** The spawner's registry (spawned sims resolve their selection
   *  from it at boot). */
  SIM_REGISTRY?: DurableObjectNamespace | undefined
  /** The registry DO's id name (default 'registry'). */
  SST_REGISTRY_ID?: string | undefined
}

/** The coarse lifecycle stage the registry reports — the platform's
 *  stage machine, as observably as a sim can answer it: a twin read
 *  CONNECTS, a /world mutation CALIBRATES, an advanced clock RUNS. */
export type SimStage = 'idle' | 'connected' | 'calibrated' | 'running'
const STAGE_RANK: Record<SimStage, number> = { idle: 0, connected: 1, calibrated: 2, running: 3 }

/** Parse the DO name into a standing selection (the '|' form:
 *  '<tag>|<serial>|<physics>' — the standing twins' names carry their
 *  selection directly). */
export function selectionFromDoName(name: string | undefined): { serial?: string; physics?: string } {
  if (!name || !name.includes('|')) return {}
  const [, serial, physics] = name.split('|')
  return { serial, physics }
}

export class SimSession {
  readonly #state: DurableObjectState
  readonly #env: SimSessionEnv
  readonly #loadBundle: (select: { physics?: string; serial?: string }) => SessionBundle
  #handler: SessionHandler | null | undefined
  #session: BundleSession | undefined
  #stage: SimStage = 'idle'

  constructor(state: DurableObjectState, env: SimSessionEnv, loadBundle: (select: { physics?: string; serial?: string }) => SessionBundle) {
    this.#state = state
    this.#env = env
    this.#loadBundle = loadBundle
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    // ── The spawner's internal endpoints (never part of the twin
    //    surface; the registry drives them). ─────────────────────────
    if (url.pathname === '/-/state') {
      return Response.json({ state: this.#currentState(), booted: this.#handler != null })
    }
    if (url.pathname === '/-/retire') {
      this.#handler = undefined
      this.#session = undefined
      this.#stage = 'idle'
      await this.#state.storage.deleteAlarm()
      return Response.json({ retired: true })
    }

    this.#handler ??= await this.#bootSafe()
    if (this.#handler == null) {
      // An unbootable sim (its registry record expired or was retired):
      // an honest, parseable answer — never a raw runtime error.
      return Response.json(
        { error: 'sim_unbootable', message: `sim '${this.#state.id?.name ?? '?'}' has no live spawn record — spawn a new sim (POST /sims)` },
        { status: 503, headers: { 'content-type': 'application/json' } },
      )
    }
    // Re-arm the idle alarm on every request (the honest lifecycle).
    await this.#state.storage.setAlarm(Date.now() + this.#idleMs())
    const res = await this.#handler(request)
    this.#observeStage(url, request.method)
    return res
  }

  /** The idle expiry: drop the in-memory session. The DO object
   *  survives; the next request boots a fresh session (same seed →
   *  same instrument; the platform's Connect re-establishes). */
  async alarm(): Promise<void> {
    this.#handler = undefined
    this.#session = undefined
    this.#stage = 'idle'
  }

  /** The stage as observably answerable RIGHT NOW: an advanced clock
   *  outranks the request bookkeeping (the Start stage's own marker). */
  #currentState(): SimStage {
    if (this.#session != null && this.#session.clock.now() > 0 && STAGE_RANK[this.#stage] < STAGE_RANK.running) {
      return 'running'
    }
    return this.#stage
  }

  /** The boot, failure-honest: an unbootable sim (a gone registry
   *  record) answers null → the caller serves the 503 shape. */
  async #bootSafe(): Promise<SessionHandler | null> {
    try {
      return await this.#boot()
    } catch {
      return null
    }
  }

  async #boot(): Promise<SessionHandler> {
    const signedServe = this.#env.SST_SIGNED_SERVE === '1' || this.#env.SST_SIGNED_SERVE === 'true'
    const select = await this.#selection()
    const session = await bootBundleSession(this.#loadBundle(select.physics ? { physics: select.physics } : {}), {
      ...(signedServe ? { signedServe } : {}),
      ...(select.serial ? { serial: select.serial } : {}),
    })
    this.#session = session
    this.#stage = 'idle'
    return createSessionHandler(session, {
      corsOrigins: this.#env.SST_CORS_ORIGINS,
      worldToken: this.#env.SIM_WORLD_TOKEN,
    })
  }

  /** The spawn selection for this DO. Spawned sims ('spawned:<id>')
   *  resolve it from the registry — the SSOT; a record that expired or
   *  was retired makes the cold boot fail LOUDLY naming that. Standing
   *  twins carry their selection in the DO name (the '|' form); the
   *  root twin resolves nothing (the default bundle, byte-identical to
   *  the pre-spawner deployment). */
  async #selection(): Promise<{ serial?: string; physics?: string }> {
    const name = this.#state.id?.name
    if (name != null && name.startsWith('spawned:')) {
      const simId = name.slice('spawned:'.length)
      const registry = this.#env.SIM_REGISTRY?.get(
        this.#env.SIM_REGISTRY.idFromName(this.#env.SST_REGISTRY_ID ?? 'registry'),
      )
      if (registry == null) throw new Error(`sim '${simId}' cannot boot: no SIM_REGISTRY binding on this deployment`)
      const res = await registry.fetch(`https://registry.internal/-/selection/${encodeURIComponent(simId)}`)
      if (!res.ok) {
        throw new Error(`sim '${simId}' cannot boot: its registry record is gone (expired or retired)`)
      }
      return await res.json() as { serial?: string; physics?: string }
    }
    return selectionFromDoName(name)
  }

  /** The coarse stage bookkeeping (the platform's stage machine, read
   *  off the sim's own served traffic). */
  #observeStage(url: URL, method: string): void {
    const path = url.pathname
    if (path === '/twin' || path.startsWith('/twin/')) {
      if (STAGE_RANK[this.#stage] < STAGE_RANK.connected) this.#stage = 'connected'
    }
    if ((path === '/world' || path.startsWith('/world/')) && method === 'POST') {
      if (STAGE_RANK[this.#stage] < STAGE_RANK.calibrated) this.#stage = 'calibrated'
    }
  }

  #idleMs(): number {
    const raw = Number(this.#env.SST_SESSION_IDLE_S ?? DEFAULT_IDLE_S)
    const seconds = Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_IDLE_S
    return seconds * 1000
  }
}
