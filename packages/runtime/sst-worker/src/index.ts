// index.ts — the SST worker entry: the deployment artifact for one
// instrument session (the instance bundle is injected at build time
// from SST_LIBRARY_PATH — see scripts/build.mjs).

import { SimSession, type SimSessionEnv } from './session-do.js'
import { librarySessionBundle } from './content.js'

export { SimSession, DEFAULT_IDLE_S, type SimSessionEnv } from './session-do.js'
export { createSessionHandler, type SessionEnvConfig, type SessionHandler } from './worker-core.js'
export { librarySessionBundle } from './content.js'

export interface Env extends SimSessionEnv {
  /** The Durable Object namespace (wrangler.toml's SIM_SESSION binding). */
  SIM_SESSION: DurableObjectNamespace
  /** The DO id name — one DO instance per simulation session (the
   *  default hosts the demo's LC-500 fresh sample). */
  SST_SESSION_ID?: string | undefined
}

/** The deployed DO class: the generic SimSession bound to the bundled
 *  library content. */
export class DemoSimSession extends SimSession {
  constructor(state: DurableObjectState, env: Env, _ctx: ExecutionContext) {
    super(state, env, librarySessionBundle)
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const id = env.SIM_SESSION.idFromName(env.SST_SESSION_ID ?? 'lc500-fresh')
    return env.SIM_SESSION.get(id).fetch(request)
  },
}
