// session-do.ts — the Durable Object holding one simulation session.
//
// One DO instance per simulation session: the connect handshake, the
// calibration, the evolving physics, the served signatures — all
// in-memory DO state (single-threaded, like the node server's one
// process). The lifecycle is honest: an idle session's alarm drops the
// in-memory state, and the next request boots a fresh session (the
// platform's Connect stage re-establishes; the physics is seeded and
// deterministic, so a fresh boot replays the same instrument).

import {
  bootBundleSession,
  type SessionBundle,
} from '@primmel/sst-runtime/session/boot-bundle'
import { createSessionHandler, type SessionEnvConfig, type SessionHandler } from './worker-core.js'

/** The idle lifetime of a session (seconds) — the SST_SESSION_IDLE_S
 *  var, default 30 minutes. */
export const DEFAULT_IDLE_S = 1800

/** The deployment env the session reads (the node bins read the same
 *  names from process.env). */
export interface SimSessionEnv extends SessionEnvConfig {
  /** '1'/'true' → the manifest's `signing:` block activates (the
   *  bundle-native face of SST_SIGNED_SERVE). */
  SST_SIGNED_SERVE?: string | undefined
  /** Session idle lifetime in seconds (default 1800). */
  SST_SESSION_IDLE_S?: string | undefined
}

export class SimSession {
  readonly #state: DurableObjectState
  readonly #env: SimSessionEnv
  readonly #loadBundle: () => SessionBundle
  #handler: SessionHandler | undefined

  constructor(state: DurableObjectState, env: SimSessionEnv, loadBundle: () => SessionBundle) {
    this.#state = state
    this.#env = env
    this.#loadBundle = loadBundle
  }

  async fetch(request: Request): Promise<Response> {
    this.#handler ??= await this.#boot()
    // Re-arm the idle alarm on every request (the honest lifecycle).
    await this.#state.storage.setAlarm(Date.now() + this.#idleMs())
    return this.#handler(request)
  }

  /** The idle expiry: drop the in-memory session. The DO object
   *  survives; the next request boots a fresh session (same seed →
   *  same instrument; the platform's Connect re-establishes). */
  async alarm(): Promise<void> {
    this.#handler = undefined
  }

  async #boot(): Promise<SessionHandler> {
    const signedServe = this.#env.SST_SIGNED_SERVE === '1' || this.#env.SST_SIGNED_SERVE === 'true'
    const session = await bootBundleSession(this.#loadBundle(), signedServe ? { signedServe } : {})
    return createSessionHandler(session, {
      corsOrigins: this.#env.corsOrigins,
      worldToken: this.#env.worldToken,
    })
  }

  #idleMs(): number {
    const raw = Number(this.#env.SST_SESSION_IDLE_S ?? DEFAULT_IDLE_S)
    const seconds = Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_IDLE_S
    return seconds * 1000
  }
}
