// index.ts — the SST worker entry: the standing twins + the spawner.
//
// Routing:
//   /sims            → the registry DO (POST spawn, GET list)
//   /sims/:id        → the registry DO (GET detail, DELETE retire)
//   /sims/:id/<rest> → THAT sim's DO, path-rewritten to /<rest> — the
//                      spawn response's `url` IS the per-sim base URL
//                      the platform's twin binding consumes
//                      (<base>/twin, <base>/world, …).
//   /lc500-002(/…)   → the second standing twin (sample-true creep-fail
//                      physics, serial LC500-002).
//   everything else  → the canonical standing twin (LC500-001, fresh)
//                      at the ROOT — the platform's seed binds this URL
//                      (TWIN_DEMO_BASE_URL); its behavior and its DO
//                      name are unchanged by the spawner work.
//
// The instance bundle is injected at build time from SST_LIBRARY_PATH
// (scripts/build.mjs). The entry exports only the fetch handler + the
// Durable Object classes (workerd's contract).

import { SimSession } from './session-do.js'
import { SimRegistry, type SpawnRegistryEnv } from './spawn-registry.js'
import { librarySessionBundle } from './content.js'

export interface Env extends SpawnRegistryEnv {
  /** The Durable Object namespaces (wrangler.toml bindings). */
  SIM_SESSION: DurableObjectNamespace
  SIM_REGISTRY: DurableObjectNamespace
  /** The root standing twin's DO id name (the seed contract's
   *  instance; default 'lc500-fresh'). */
  SST_SESSION_ID?: string | undefined
  /** The registry DO's id name (default 'registry'). */
  SST_REGISTRY_ID?: string | undefined
  /** '1'/'true' → the manifest's `signing:` block activates. */
  SST_SIGNED_SERVE?: string | undefined
  /** Session idle lifetime in seconds (default 1800). */
  SST_SESSION_IDLE_S?: string | undefined
}

/** A simulation-session DO (a standing twin OR a spawned sim — the DO's
 *  name carries the spawn selection; see session-do.ts). */
export class DemoSimSession extends SimSession {
  constructor(state: DurableObjectState, env: Env, _ctx: ExecutionContext) {
    super(state, env, (select) => librarySessionBundle(select))
  }
}

/** The spawner's registry DO. */
export class SimRegistryDO extends SimRegistry {}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const path = url.pathname

    // ── The spawner surface ─────────────────────────────────────────
    if (path === '/sims' || path.startsWith('/sims/')) {
      const registry = env.SIM_REGISTRY.get(
        env.SIM_REGISTRY.idFromName(env.SST_REGISTRY_ID ?? 'registry'),
      )
      const perSim = /^\/sims\/([^/]+)(\/.+)?$/.exec(path)
      if (perSim && perSim[2] != null) {
        // The per-sim base URL's own surface: /sims/<id>/twin → /twin …
        // The DO is named 'spawned:<id>' (it resolves its serial +
        // physics from the registry at boot).
        const simId = decodeURIComponent(perSim[1]!)
        const inner = new URL(request.url)
        inner.pathname = perSim[2]
        const sim = env.SIM_SESSION.get(env.SIM_SESSION.idFromName(`spawned:${simId}`))
        return sim.fetch(new Request(inner, request))
      }
      return registry.fetch(request)
    }

    // ── The second standing twin (sample-true LC500-002) ────────────
    if (path === '/lc500-002' || path.startsWith('/lc500-002/')) {
      const rest = path === '/lc500-002' ? '/' : path.slice('/lc500-002'.length)
      const inner = new URL(request.url)
      inner.pathname = rest
      const sim = env.SIM_SESSION.get(
        env.SIM_SESSION.idFromName('standing-lc500-002|LC500-002|creep-fail'),
      )
      return sim.fetch(new Request(inner, request))
    }

    // ── The canonical standing twin at the ROOT (unchanged) ─────────
    const standing = env.SIM_SESSION.get(
      env.SIM_SESSION.idFromName(env.SST_SESSION_ID ?? 'lc500-fresh'),
    )
    return standing.fetch(request)
  },
}
