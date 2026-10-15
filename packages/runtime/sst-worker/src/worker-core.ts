// worker-core.ts — the sim session's HTTP surface on the fetch API.
//
// The worker adapter's half of server.ts: the same routes, the same
// answers, the same CORS matcher, the same /world mutation guard, the
// same REST projection — with the node transport (createServer +
// req/res) replaced by Request → Response. The route-surface parity
// tests pin this file against the node server per route.

import { createYoga, type Plugin } from 'graphql-yoga'
import {
  authorizationOf,
  corsOriginAllowed,
  landing,
  operationTypeOf,
  worldMutationGuard,
} from '@primmel/sst-runtime/server'
import { readerFor, instrumentMirrorObject } from '@primmel/sst-runtime/twin-schema'
import { FRESH_WITHIN_HEADER } from '@primmel/sst-runtime/twin-openapi'
import type { BundleSession } from '@primmel/sst-runtime/session/boot-bundle'

/** The deployment knobs the adapter reads from the worker env (the
 *  node server reads the same from process.env via the bins). */
export interface SessionEnvConfig {
  /** CORS origins for browser clients (SST_CORS_ORIGINS): comma-
   *  separated origins, or '*'. Unset → no CORS headers at all (the
   *  honest closed posture — a deployment must name its consumers). */
  corsOrigins?: string | undefined
  /** Bearer token guarding /world mutations (SIM_WORLD_TOKEN). */
  worldToken?: string | undefined
}

/** The yoga server context the guard plugin reads. The node server
 *  carries the raw IncomingMessage; the worker carries a plain header
 *  view — `authorizationOf` reads the same shape off both. */
interface WorkerCtx {
  req: { headers: { authorization?: string | string[] } }
}

function authView(request: Request): WorkerCtx {
  const authorization = request.headers.get('authorization') ?? undefined
  return { req: { headers: { authorization } } }
}

export interface SessionHandler {
  (request: Request): Promise<Response>
}

/** Build the request handler for one booted session: the worker-core
 *  mirror of createSimServer's request listener. */
export function createSessionHandler(session: BundleSession, config: SessionEnvConfig): SessionHandler {
  const worldYoga = createYoga<WorkerCtx>({
    schema: session.worldSchema,
    graphqlEndpoint: '/world',
    graphiql: true,
    plugins: config.worldToken
      ? [worldMutationGuard(config.worldToken) as unknown as Plugin<WorkerCtx>]
      : [],
  })
  const twinYoga = createYoga<WorkerCtx>({
    schema: session.twinSchema,
    graphqlEndpoint: '/twin',
    graphiql: true,
  })

  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url)
    // ── CORS: the node server's exact matcher + headers. ────────────
    const requestOrigin = request.headers.get('origin')
    const corsAllow = config.corsOrigins && requestOrigin
      ? config.corsOrigins === '*'
        ? '*'
        : corsOriginAllowed(config.corsOrigins, requestOrigin)
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
            'access-control-allow-methods': 'GET, POST, OPTIONS',
            'access-control-allow-headers': 'content-type, authorization',
          },
        })
      }
      return new Response(null, { status: 403, headers: { 'content-type': 'text/plain' } })
    }

    // ── Real-time twin streaming (SSE) ──────────────────────────────
    if (url.pathname === '/twin/stream' && request.method === 'GET') {
      return withCors(handleTwinStream(session, url, request))
    }
    // ── The OpenAPI twin leg ─────────────────────────────────────────
    if (url.pathname === '/openapi.json' && request.method === 'GET') {
      return withCors(new Response(JSON.stringify(session.openApiDoc, null, 2) + '\n', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }))
    }
    if (request.method === 'GET' && url.pathname.startsWith('/twin/registers/')) {
      return withCors(await handleRestRegister(url.pathname.slice('/twin/registers/'.length), session))
    }
    if (request.method === 'POST' && url.pathname.startsWith('/twin/operations/')) {
      return withCors(handleRestOperation(url.pathname.slice('/twin/operations/'.length), session))
    }
    if (request.method === 'GET' && url.pathname === '/twin/instrument') {
      if (!session.contract.model) {
        return withCors(new Response('the contract carries no instrument model', {
          status: 404, headers: { 'content-type': 'text/plain' },
        }))
      }
      return withCors(new Response(JSON.stringify(instrumentMirrorObject(session.contract.model, session.contract)) + '\n', {
        status: 200, headers: { 'content-type': 'application/json' },
      }))
    }
    if (url.pathname === '/world' || url.pathname.startsWith('/world/')) {
      return withCors(await worldYoga.fetch(request, authView(request)))
    }
    if (url.pathname === '/twin' || url.pathname.startsWith('/twin/')) {
      return withCors(await twinYoga.fetch(request, authView(request)))
    }
    // The built-in landing page (the worker serves no bench dist —
    // the same landing the node server answers without one).
    if (url.pathname === '/') {
      return withCors(new Response(landing(session.title), {
        status: 200, headers: { 'content-type': 'text/html; charset=utf-8' },
      }))
    }
    return withCors(new Response('not found', { status: 404, headers: { 'content-type': 'text/plain' } }))
  }
}

// ── The REST projection (the node handlers' fetch-port) ────────────────

/** GET /twin/registers/<target> — the REST projection of one declared
 *  serve, through the SAME readerFor the GraphQL resolver binds to
 *  (the signed-serve posture signs here too). The declared
 *  fresh_within_s rides as the response header. */
async function handleRestRegister(target: string, session: BundleSession): Promise<Response> {
  const serve = session.contract.serves.find((s) => s.target === target)
  if (!serve) {
    return new Response(`no declared serve for register '${target}'`, {
      status: 404, headers: { 'content-type': 'text/plain' },
    })
  }
  try {
    const value = await readerFor(target, session.twinIo)()
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    if (serve.freshWithinS != null) headers[FRESH_WITHIN_HEADER] = String(serve.freshWithinS)
    return new Response(JSON.stringify(value) + '\n', { status: 200, headers })
  } catch (err) {
    return new Response((err as Error).message, {
      status: 500, headers: { 'content-type': 'text/plain' },
    })
  }
}

/** POST /twin/operations/<op_id> — the REST projection of one declared
 *  command operation: the instrument-legal implementation runs first,
 *  then the operational state answers (the GraphQL Mutation's shape).
 *  The single-instrument binding mirrors the node handler exactly (the
 *  node 501 answers only the composite read-delegate binding, which the
 *  worker does not serve). */
function handleRestOperation(opId: string, session: BundleSession): Response {
  const op = session.contract.operations.find((o) => o.id === opId && o.kind === 'command')
  if (!op) {
    return new Response(`no declared command operation '${opId}'`, {
      status: 404, headers: { 'content-type': 'text/plain' },
    })
  }
  try {
    session.twinIo.operations?.[op.id]?.()
    const inst = session.twinIo.instrument as { operationalState(): unknown }
    return new Response(JSON.stringify({ state: inst.operationalState() }) + '\n', {
      status: 200, headers: { 'content-type': 'application/json' },
    })
  } catch (err) {
    return new Response((err as Error).message, {
      status: 500, headers: { 'content-type': 'text/plain' },
    })
  }
}

// ── Real-time twin streaming (the SSE endpoint's fetch-port) ───────────

/** GET /twin/stream?targets=indication,state — one event per clock
 *  advance, a keepalive every 5s, the node endpoint's exact wire
 *  format (`id`/`event: twin`/`data` + `: keepalive` comments). */
function handleTwinStream(session: BundleSession, url: URL, request: Request): Response {
  const requestedTargets = url.searchParams.get('targets')?.split(',').map((s) => s.trim()).filter(Boolean)
    ?? session.stream.targets
    ?? ['indication']
  const encoder = new TextEncoder()

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const enqueue = (chunk: string): void => {
        try { controller.enqueue(encoder.encode(chunk)) } catch { /* stream closed */ }
      }
      const emit = (): void => {
        const now = session.clock.now()
        const payload = {
          timestamp: now,
          targets: requestedTargets.map((target) => ({ target, value: session.stream.read(target) })),
        }
        enqueue(`id: ${String(now)}\nevent: twin\ndata: ${JSON.stringify(payload)}\n\n`)
      }
      // The current state first (the node endpoint's first event).
      emit()
      const offClock = session.clock.onAdvance(emit)
      const heartbeat = setInterval(() => enqueue(': keepalive\n\n'), 5000)
      const cleanup = (): void => {
        offClock()
        clearInterval(heartbeat)
        try { controller.close() } catch { /* already closed */ }
      }
      request.signal?.addEventListener('abort', cleanup)
    },
    cancel() {
      // (the abort listener above performs the teardown)
    },
  })

  return new Response(stream, {
    status: 200,
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      'connection': 'keep-alive',
      'x-accel-buffering': 'no',
    },
  })
}
