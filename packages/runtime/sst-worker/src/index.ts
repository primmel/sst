// index.ts — the SST worker entry: the deployment artifact for one
// instrument session (the instance bundle is injected at build time
// from SST_LIBRARY_PATH — see scripts/build.mjs).
//
// The entry exports ONLY the fetch handler + the Durable Object class
// (workerd's contract); the adapter's building blocks are imported from
// ./session-do.js, ./worker-core.js, and ./content.js directly.

import { SimSession } from './session-do.js'
import { librarySessionBundle } from './content.js'

export interface Env {
  /** The Durable Object namespace (wrangler.toml's SIM_SESSION binding). */
  SIM_SESSION: DurableObjectNamespace
  /** CORS origins for browser clients (comma-separated or '*'). */
  SST_CORS_ORIGINS?: string | undefined
  /** Bearer token guarding /world mutations. */
  SIM_WORLD_TOKEN?: string | undefined
  /** '1'/'true' → the manifest's `signing:` block activates. */
  SST_SIGNED_SERVE?: string | undefined
  /** The DO id name — one DO instance per simulation session (the
   *  default hosts the demo's LC-500 fresh sample). */
  SST_SESSION_ID?: string | undefined
  /** Session idle lifetime in seconds (default 1800). */
  SST_SESSION_IDLE_S?: string | undefined
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
