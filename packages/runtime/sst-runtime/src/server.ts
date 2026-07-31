// server.ts — the dual-schema HTTP server (spec §3/§9): one process
// hosting /world (simulated actions), /twin (the SMART digital twin
// interface — generated or baked; a clear placeholder until then),
// GraphiQL playgrounds for both, and the landing/bench at /.
import { createServer, type Server } from 'node:http'
import { createYoga, createSchema, createGraphQLError, type Plugin } from 'graphql-yoga'
import { GraphQLError, type DocumentNode, type GraphQLSchema } from 'graphql'
import { readFile } from 'node:fs/promises'
import { join, extname } from 'node:path'

export interface TwinStreamSource {
  /** The clock that drives indication updates. */
  clock: { onAdvance: (fn: () => void) => () => void; now: () => number }
  /** Read one twin target (indication, state, environmental_context, …). */
  read: (target: string) => unknown
  /** Which targets to stream. */
  targets: string[]
}

export interface SimServerOptions {
  worldSchema: GraphQLSchema
  /** the generated/baked twin schema; absent → honest placeholder. */
  twinSchema?: GraphQLSchema | undefined
  /** static bench directory (the @sim/bench build output); absent →
   *  the built-in landing page. */
  benchDir?: string | undefined
  /** 0 = ephemeral. */
  port: number
  /** landing-page title block (instrument id + scenario). */
  title?: string | undefined
  /** bearer token guarding /world MUTATIONS (the TODO.v2/11 opt-in):
   *  set ⇒ every world mutation requires `Authorization: Bearer
   *  <token>`; world queries and the whole /twin channel stay open.
   *  Absent ⇒ the world channel is fully open (the localhost dev
   *  posture). The bins wire this from SIM_WORLD_TOKEN. */
  worldToken?: string | undefined
  /** When present, adds a GET /twin/stream endpoint serving real-time
   *  Server-Sent Events for continuous twin indication monitoring.
   *  Clients connect with `EventSource('/twin/stream?targets=indication,state')`.
   *  Each event: `{ target, value, servedAt, freshness }`. */
  twinStream?: TwinStreamSource | undefined
}

export interface SimServer {
  url: string
  close: () => Promise<void>
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
}

const TWIN_PLACEHOLDER_MESSAGE = 'twin schema not generated/baked — pass twinSchema to createSimServer (see docs §6/§9)'

/** The operation type the request will execute, honoring operationName
 *  the way graphql-js selects it (absent → the single operation). */
function operationTypeOf(document: DocumentNode, operationName: string | null | undefined): string | undefined {
  for (const def of document.definitions) {
    if (def.kind !== 'OperationDefinition') continue
    if (operationName == null || def.name?.value === operationName) return def.operation
  }
  return undefined
}

/** The Authorization header off the raw node request (the yoga context
 *  carries the IncomingMessage — see the cast in createServer below). */
function authorizationOf(req: unknown): string | undefined {
  const header = (req as { headers?: { authorization?: string | string[] } } | null)?.headers?.authorization
  return Array.isArray(header) ? header[0] : header
}

/** The /world mutation guard (TODO.v2/11): an envelop plugin at the
 *  transport edge — never in the physics. A mutation without the
 *  bearer token is rejected 401 before any resolver runs; queries
 *  (and named-operation documents selecting a query) pass through. */
function worldMutationGuard(token: string): Plugin<{ req: Request }> {
  return {
    onExecute({ args }) {
      if (operationTypeOf(args.document, args.operationName) !== 'mutation') return
      if (authorizationOf(args.contextValue.req) !== `Bearer ${token}`) {
        throw createGraphQLError(
          'unauthorized: /world mutations require Authorization: Bearer <token> (the sim was started with SIM_WORLD_TOKEN set)',
          { extensions: { code: 'UNAUTHORIZED', http: { status: 401, headers: { 'www-authenticate': 'Bearer realm="/world"' } } } },
        )
      }
    },
  }
}

function landing(title: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:system-ui,sans-serif;margin:3rem auto;max-width:44rem;line-height:1.5}
code{background:#f2f2f2;padding:.1em .3em;border-radius:4px}</style></head><body>
<h1>${title}</h1>
<p>A simulated measuring instrument (sim-instruments). Two channels:</p>
<ul>
<li><b><a href="/twin">/twin</a></b> — the SMART digital twin interface (what a certification engine may query). <a href="/twin">GraphiQL</a></li>
<li><b><a href="/world">/world</a></b> — simulated actions (the physical world: loads, environment, time). <a href="/world">GraphiQL</a></li>
</ul>
<p>The twin answers only what a real instrument could legally answer; the world is reality. Try <code>{ groundTruth { appliedLoadKg } }</code> on <code>/world</code>, then <code>mutation { placeLoad(massKg: 40) { groundTruth { appliedLoadKg } } }</code>.</p>
</body></html>`
}

export async function createSimServer(opts: SimServerOptions): Promise<SimServer> {
  const title = opts.title ?? 'simulated instrument'
  const worldYoga = createYoga<{ req: Request }>({
    schema: opts.worldSchema,
    graphqlEndpoint: '/world',
    graphiql: true,
    plugins: opts.worldToken ? [worldMutationGuard(opts.worldToken)] : [],
  })
  const twinYoga = opts.twinSchema
    ? createYoga<{ req: Request }>({ schema: opts.twinSchema, graphqlEndpoint: '/twin', graphiql: true })
    : createYoga<{ req: Request }>({
        schema: createSchema({
          typeDefs: `type Query { _twinPlaceholder: String }`,
          resolvers: {
            Query: {
              _twinPlaceholder: () => {
                throw new GraphQLError(TWIN_PLACEHOLDER_MESSAGE)
              },
            },
          },
        }),
        graphqlEndpoint: '/twin',
        graphiql: true,
        // the placeholder IS the masked message: any resolver error
        // reaches the client as exactly this text, independent of
        // error-class identity across the CJS/ESM boundary.
        maskedErrors: { errorMessage: TWIN_PLACEHOLDER_MESSAGE },
      })

  const server: Server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    // ── Real-time twin streaming (SSE) ──────────────────────────────
    // GET /twin/stream?targets=indication,state → text/event-stream
    // Emits one event per clock advance, carrying the twin values.
    // Heartbeat every 5s keeps the connection alive through proxies.
    if (url.pathname === '/twin/stream' && req.method === 'GET' && opts.twinStream) {
      return handleTwinStream(req as never, res as never, url, opts.twinStream)
    }
    if (url.pathname === '/world' || url.pathname.startsWith('/world/')) return worldYoga(req, res, { req: req as unknown as Request })
    if (url.pathname === '/twin' || url.pathname.startsWith('/twin/')) return twinYoga(req, res, { req: req as unknown as Request })
    // static bench or the landing page
    if (opts.benchDir) {
      const rel = url.pathname === '/' ? 'index.html' : url.pathname.replace(/^\/+/, '')
      try {
        const body = await readFile(join(opts.benchDir, rel))
        res.writeHead(200, { 'content-type': MIME[extname(rel)] ?? 'application/octet-stream' })
        return res.end(body)
      } catch { /* fall through to landing/404 */ }
    }
    if (url.pathname === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      return res.end(landing(title))
    }
    res.writeHead(404, { 'content-type': 'text/plain' })
    res.end('not found')
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(opts.port, () => resolve())
  })
  // the honesty line (TODO.v2/11): say plainly whether /world is guarded
  console.log(opts.worldToken
    ? '/world mutations guarded — Authorization: Bearer <token> required (SIM_WORLD_TOKEN)'
    : '/world channel OPEN — mutations unguarded (localhost dev posture; set SIM_WORLD_TOKEN before any non-local deployment)')
  const addr = server.address()
  const port = typeof addr === 'object' && addr ? addr.port : opts.port
  return {
    url: `http://localhost:${port}`,
    close: () => new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve())),
  }
}

/** Handle a GET /twin/stream request — real-time SSE for continuous
 *  twin indication monitoring.
 *
 *  The stream emits one event per clock advance. Each event carries the
 *  requested twin targets' current values, the servedAt timestamp, and
 *  the freshness status.
 *
 *  Clients connect with:
 *    new EventSource('/twin/stream?targets=indication,state')
 *
 *  Heartbeat comments (`:keepalive\n\n`) every 5s keep the connection
 *  alive through reverse proxies. The `Last-Event-ID` header supports
 *  resumability (future work). */
function handleTwinStream(
  req: NodeJS.ReadableStream & { headers: Record<string, string | undefined> },
  res: NodeJS.WritableStream & { write: (chunk: string) => boolean; writeHead: (status: number, headers: Record<string, string>) => void },
  url: URL,
  source: TwinStreamSource,
): void {
  const requestedTargets = url.searchParams.get('targets')?.split(',').map(s => s.trim()).filter(Boolean)
    ?? source.targets
    ?? ['indication']

  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache, no-transform',
    'connection': 'keep-alive',
    'x-accel-buffering': 'no',
  })

  // Emit the current state immediately (the first event a new client sees).
  emitTwinEvent(res, source, requestedTargets)

  // On every clock advance, emit a new event.
  const offClock = source.clock.onAdvance(() => {
    emitTwinEvent(res, source, requestedTargets)
  })

  // Heartbeat every 5 seconds — keeps the connection alive through
  // proxies and load balancers that drop idle connections.
  const heartbeat = setInterval(() => {
    try { res.write(': keepalive\n\n') } catch { /* connection closed */ }
  }, 5000)

  // Clean up on disconnect.
  req.on('close', () => {
    offClock()
    clearInterval(heartbeat)
  })
}

function emitTwinEvent(
  res: NodeJS.WritableStream & { write: (chunk: string) => boolean },
  source: TwinStreamSource,
  targets: string[],
): void {
  const now = source.clock.now()
  const payload = {
    timestamp: now,
    targets: targets.map(target => {
      const value = source.read(target)
      return { target, value }
    }),
  }
  const eventId = String(now)
  const data = JSON.stringify(payload)
  try { res.write(`id: ${eventId}\nevent: twin\ndata: ${data}\n\n`) } catch { /* closed */ }
}
