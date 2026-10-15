// tests/lib.ts — shared test helpers: the synthetic bundle (no library
// needed — the boot-bundle mechanics + transport parity legs) and the
// node-vs-worker request harness.

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { BundleSession, SessionBundle } from '@primmel/sst-runtime/session/boot-bundle'
import { createSimServer, type SimServer } from '@primmel/sst-runtime/server'
import { createSessionHandler, type SessionHandler } from '../src/worker-core.js'

export { assembleLibraryBundle } from '../src/assemble-bundle.js'

/** The declared instrument library (SST_LIBRARY_PATH), or null — the
 *  library-dependent legs skip honestly (the bake-freshness doctrine). */
export function libraryRoot(): string | null {
  const declared = process.env.SST_LIBRARY_PATH
  if (!declared) return null
  return existsSync(join(declared, 'packages', 'kinds')) ? declared : null
}

/** A minimal deterministic load cell: the smallest instrument that
 *  satisfies the TwinInstrumentView surface + the /world core surface.
 *  The indication FOLLOWS the applied load (placeLoad → indication). */
export function syntheticBehaviorModule(): unknown {
  const create = (def: { coefficients?: Record<string, number> }, clock: { now(): number }) => {
    let loadKg = 0
    return {
      indication: () => ({ value: loadKg, unit: 'kg', kind: 'mass', servedAt: clock.now() }),
      servedAt: () => clock.now(),
      operationalState: () => (loadKg > 300 ? 'overload' : 'running'),
      state: () => (loadKg > 300 ? 'overload' : 'running'),
      groundTruth: () => ({ appliedLoadKg: loadKg }),
      placeMass: (kg: number) => { loadKg = kg },
      removeMass: () => { loadKg = 0 },
      runSelfTest: () => { /* the instrument-legal no-op */ },
      setEnvironment: () => { /* the world core surface */ },
      injectFault: () => { /* the world core surface */ },
      clearFault: () => { /* the world core surface */ },
      reset: () => { loadKg = 0 },
    }
  }
  return { create }
}

/** The physics selection mirrors the real bundle's sample menu: each
 *  named profile answers its own sample_name + serial. */
const SYNTHETIC_SERIALS: Record<string, string> = {
  fresh: 'SYN-001',
  'creep-fail': 'SYN-002',
  'creep-fail-001': 'SYN-001',
}

/** The synthetic bundle: a complete instance+kind pair small enough to
 *  read in one screen — manifest, coefficients, SDL, mapping, handlers,
 *  baked contract, behavior. No library checkout needed. */
export function syntheticBundle(select: { physics?: string } = {}): SessionBundle {
  const physics = select.physics ?? 'fresh'
  const serial = SYNTHETIC_SERIALS[physics] ?? `SYN-${physics}`
  const manifest = {
    sst_version: '1.0',
    tier: 'primmel-instance' as const,
    id: 'synthetic-cell',
    title: 'Synthetic cell (worker-adapter test)',
    kind: 'primmel-sst-r60',
    classification: { accuracy_class: 'C', class_number: 3, n_lc: 3000, construction: 'column', technology: 'strain-gauge' },
    design_parameters: {
      e_max: { value: 100, unit: 'kg' },
      e_min: { value: 0, unit: 'kg' },
      n_lc: { value: 3000 },
    },
    provenance: { certificate: 'SYN/2026-001', first_issued: '2026-01-01' },
  }
  return {
    instance: {
      manifest,
      coefficientsYaml: [
        'mechanical:',
        '  compliance_mm_per_kg: 0.001',
        'transduction:',
        '  sensitivity_mVperV: 2.0',
        'conditioning:',
        '  scale_interval_kg: 0.01',
      ].join('\n'),
      sampleYaml: [
        `sample_name: ${physics}`,
        `serial_number: ${serial}`,
      ].join('\n'),
      sampleRef: physics,
    },
    kind: {
      worldKindSdl: [
        'extend type Mutation {',
        '  placeLoad(massKg: Float!): WorldState!',
        '  removeLoad: WorldState!',
        '}',
        'extend type GroundTruth {',
        '  appliedLoadKg: Float!',
        '}',
      ].join('\n'),
      worldKindYaml: [
        'mutations:',
        '  placeLoad:',
        '    handler: applyMass',
        '  removeLoad:',
        '    handler: removeMass',
      ].join('\n'),
      handlers: {
        applyMass: (ctx, args) => {
          (ctx.instrument as unknown as { placeMass(kg: number): void }).placeMass(args.massKg as number)
        },
        removeMass: (ctx) => {
          (ctx.instrument as unknown as { removeMass(): void }).removeMass()
        },
      },
      twinContractJson: {
        format: 'sim/baked-twin-contract',
        version: 1,
        bakedAt: '2026-01-01T00:00:00.000Z',
        source: 'synthetic',
        contract: {
          instrumentId: 'synthetic-cell',
          serves: [
            { target: 'indication', via: 'get_indication', freshWithinS: 5 },
            { target: 'state', via: 'watch_state', freshWithinS: 1 },
          ],
          operations: [
            { id: 'get_indication', kind: 'query' },
            { id: 'watch_state', kind: 'watch' },
            { id: 'run_self_test', kind: 'command' },
          ],
        },
      },
    },
    behaviorModule: syntheticBehaviorModule(),
  }
}

/** The node transport for one booted session (the SAME schemas the
 *  worker handler serves — the parity legs isolate the transport). */
export async function nodeServerFor(
  session: BundleSession,
  opts: { corsOrigins?: string; worldToken?: string } = {},
): Promise<SimServer> {
  return createSimServer({
    worldSchema: session.worldSchema,
    twinSchema: session.twinSchema,
    port: 0,
    title: session.title,
    ...(opts.corsOrigins != null ? { corsOrigins: opts.corsOrigins } : {}),
    ...(opts.worldToken != null ? { worldToken: opts.worldToken } : {}),
    openApiDoc: session.openApiDoc,
    twinRest: { contract: session.contract, io: session.twinIo },
    twinStream: {
      clock: session.clock,
      targets: session.stream.targets,
      read: session.stream.read,
    },
  })
}

/** The worker transport for one booted session. */
export function workerHandlerFor(
  session: BundleSession,
  opts: { corsOrigins?: string; worldToken?: string } = {},
): SessionHandler {
  return createSessionHandler(session, opts)
}

/** The first SSE event off a /twin/stream response (id + parsed data). */
export async function firstSseEvent(res: Response): Promise<{ id: string; data: string }> {
  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  while (!buffer.includes('\n\n')) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
  }
  reader.cancel().catch(() => {})
  const id = /id: (.*)/.exec(buffer)?.[1] ?? ''
  const data = /data: (.*)/.exec(buffer)?.[1] ?? ''
  return { id, data }
}

/** The transport-neutral request adapter: path + init → Response. The
 *  node side fetches the booted server's URL; the worker side builds a
 *  Request into the session handler. */
export type Http = (path: string, init?: RequestInit) => Promise<Response>

export function nodeHttp(serverUrl: string): Http {
  return (path, init) => fetch(new URL(path, serverUrl), init)
}

export function workerHttp(handler: SessionHandler, base = 'http://worker.local'): Http {
  return (path, init) => handler(new Request(new URL(path, base), init))
}

/** The shared request script both transports run (the same sequence →
 *  the same answers). */
export interface ParityCase {
  name: string
  request: (http: Http) => Promise<Response>
  /** Compare bodies as JSON (default: exact text). */
  json?: boolean
  /** Skip the body comparison (assert only status). */
  statusOnly?: boolean
}

export function parityCases(origin?: string): ParityCase[] {
  const headers: Record<string, string> = origin ? { origin } : {}
  return [
    {
      name: 'GET / (the landing)',
      request: (http) => http('/', { headers }),
      statusOnly: true,
    },
    {
      name: 'GET /world (GraphiQL)',
      request: (http) => http('/world', { headers: { ...headers, accept: 'text/html' } }),
      statusOnly: true,
    },
    {
      name: 'GET /twin (GraphiQL)',
      request: (http) => http('/twin', { headers: { ...headers, accept: 'text/html' } }),
      statusOnly: true,
    },
    {
      name: 'POST /world introspection',
      request: (http) => http('/world', {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify({ query: '{ __schema { mutationType { fields { name } } } }' }),
      }),
      json: true,
    },
    {
      name: 'POST /world placeLoad',
      request: (http) => http('/world', {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify({ query: 'mutation { placeLoad(massKg: 40) { groundTruth { appliedLoadKg } } }' }),
      }),
      json: true,
    },
    {
      name: 'POST /world clock query',
      request: (http) => http('/world', {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify({ query: '{ clock }' }),
      }),
      json: true,
    },
    {
      name: 'POST /twin introspection',
      request: (http) => http('/twin', {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify({ query: '{ __schema { queryType { fields { name } } mutationType { fields { name } } } }' }),
      }),
      json: true,
    },
    {
      name: 'POST /twin indication+state',
      request: (http) => http('/twin', {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify({ query: '{ indication { value unit servedAt } state }' }),
      }),
      json: true,
    },
    {
      name: 'GET /twin/registers/indication',
      request: (http) => http('/twin/registers/indication', { headers }),
      json: true,
    },
    {
      name: 'GET /twin/registers/state',
      request: (http) => http('/twin/registers/state', { headers }),
      json: true,
    },
    {
      name: 'GET /twin/registers/nope (unknown serve)',
      request: (http) => http('/twin/registers/nope', { headers }),
    },
    {
      name: 'POST /twin/operations/run_self_test',
      request: (http) => http('/twin/operations/run_self_test', { method: 'POST', headers }),
      json: true,
    },
    {
      name: 'POST /twin/operations/nope (unknown op)',
      request: (http) => http('/twin/operations/nope', { method: 'POST', headers }),
    },
    {
      name: 'GET /twin/instrument',
      request: (http) => http('/twin/instrument', { headers }),
      json: true,
    },
    {
      name: 'GET /openapi.json',
      request: (http) => http('/openapi.json', { headers }),
      json: true,
    },
    {
      name: 'GET /nowhere (404)',
      request: (http) => http('/nowhere', { headers }),
    },
    ...(origin
      ? [{
          name: 'OPTIONS preflight (allowed origin)',
          request: (http: Http) => http('/world', {
            method: 'OPTIONS',
            headers: { origin, 'access-control-request-method': 'POST' },
          }),
          statusOnly: true,
        }]
      : []),
  ]
}

/** Assert one parity case across the two transports (same request →
 *  the same answer: status, body, and the picked headers). */
export async function expectParity(nodeHttpBase: Http, workerHttpBase: Http, c: ParityCase): Promise<void> {
  const nodeRes = await c.request(nodeHttpBase)
  const workerRes = await c.request(workerHttpBase)
  if (nodeRes.status !== workerRes.status) {
    throw new Error(`${c.name}: status ${nodeRes.status} ≠ worker ${workerRes.status}`)
  }
  if (c.statusOnly) return
  const nodeBody = await nodeRes.text()
  const workerBody = await workerRes.text()
  if (c.json) {
    const same = JSON.stringify(JSON.parse(nodeBody)) === JSON.stringify(JSON.parse(workerBody))
    if (!same) {
      throw new Error(`${c.name}: bodies differ\n  node:   ${nodeBody.slice(0, 400)}\n  worker: ${workerBody.slice(0, 400)}`)
    }
  } else if (nodeBody !== workerBody) {
    throw new Error(`${c.name}: bodies differ\n  node:   ${nodeBody.slice(0, 400)}\n  worker: ${workerBody.slice(0, 400)}`)
  }
}
