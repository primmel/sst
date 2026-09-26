// twin-openapi.ts — the OpenAPI projection of the twin contract
// (the smart platform's TODO.twin-demo/06; spec §12 §5.5): an OpenAPI
// 3.1 document GENERATED from the same TwinContract the GraphQL leg
// bakes from (law 2: never hand-written — one contract, two
// projections). REST-native consumers discover the twin's legal
// surface without GraphQL introspection.
//
// The projection, per contract declaration:
//   serve            → GET  /registers/<target>   (the ServedQuantity /
//                      state / Environment shape; the fresh_within
//                      bound rides as the fresh-within-s response header)
//   command op       → POST /operations/<op_id>   (answers OpResult)
//   instrument model → GET  /instrument           (the same mirror object
//                      Query.instrument resolves to)
//   the SSE stream   → GET  /stream               (text/event-stream —
//                      documented, served by the existing endpoint)
// The paths are relative to the /twin channel root (servers: /twin).
//
// The signed-serve posture (spec §12 §3.9) appears in the document as
// first-class components: under signing, ServedQuantity carries
// servedAt as canonical-ISO string + the signature member ($ref
// ServeSignature — the snake_case envelope block), so a generated
// client inherits the verification posture.
//
// The /world channel is deliberately absent — it is the simulation
// interface, not the instrument's legal API (the TODO's boundary).
import type { TwinContract, TwinOperation, InstrumentModel } from './twin-contract.js'
import { snakeToCamel } from './twin-schema.js'

type JsonSchema = Record<string, unknown>

export interface TwinOpenApiOptions {
  /** The signed-serve posture (spec §12): quantity serves carry the
   *  canonical-ISO servedAt + the signature envelope member. */
  signed?: boolean
  /** Per-serve signedness (the composite boot, spec §13): each
   *  composite register inherits its SOURCE COMPONENT's posture, so a
   *  composite may mix signing and unsigned components. When present,
   *  membership decides a serve's shape and `signed` is ignored; the
   *  envelope components are emitted when the set is non-empty. */
  signedTargets?: ReadonlySet<string>
  /** Per-serve return-schema overrides (the composite boot): a serve
   *  whose wire shape the target-name heuristic cannot infer — the
   *  computed composite state (a bare string under a camelCase target),
   *  an Environment serve under a composite spelling — declares its
   *  schema here. The composite boot derives these from the same
   *  component contracts the GraphQL leg types its fields from. */
  serveSchemas?: Record<string, JsonSchema>
}

/** The freshness response header name (one spelling across the document
 *  and the runtime route). */
export const FRESH_WITHIN_HEADER = 'fresh-within-s'

/** The return-type schema for one serve target (the twin-schema.ts
 *  mapping, projected to JSON Schema). */
function serveSchemaRef(target: string, signed: boolean): JsonSchema {
  if (target === 'state') return { type: 'string', description: 'The operational state.' }
  if (target === 'environmental_context') return { $ref: '#/components/schemas/Environment' }
  return { $ref: `#/components/schemas/${signed ? 'SignedServedQuantity' : 'ServedQuantity'}` }
}

/** One GET operation for a serve. The fresh_within bound is documented
 *  as a first-class response header. */
function servePathItem(target: string, via: string, freshWithinS: number | undefined, schema: JsonSchema): JsonSchema {
  const headers: Record<string, unknown> = {}
  if (freshWithinS != null) {
    headers[FRESH_WITHIN_HEADER] = {
      schema: { type: 'integer' },
      description: `The declared freshness bound (fresh_within ${freshWithinS}s): a served value older than this many seconds is stale.`,
    }
  }
  return {
    get: {
      operationId: via,
      summary: `Read the '${target}' register.`,
      responses: {
        '200': {
          description: `The '${target}' serve.`,
          ...(Object.keys(headers).length ? { headers } : {}),
          content: { 'application/json': { schema } },
        },
      },
    },
  }
}

/** The component schemas — ServedQuantity mirrors the GraphQL leg's
 *  base types exactly (unsigned: epoch-seconds servedAt; signed:
 *  canonical-ISO servedAt + the ServeSignature envelope). */
function componentSchemas(model: InstrumentModel | undefined, signed: boolean): Record<string, JsonSchema> {
  const schemas: Record<string, JsonSchema> = {
    ServedQuantity: {
      type: 'object',
      required: ['value', 'unit', 'kind', 'servedAt'],
      properties: {
        value: { type: 'number' },
        unit: { type: 'string', description: 'BIPM Digital SI Framework unit URI.' },
        kind: { type: 'string' },
        servedAt: { type: 'number', description: 'The serve time, epoch seconds.' },
      },
    },
    Environment: {
      type: 'object',
      required: ['temperatureDegC', 'humidityPercentRh', 'pressureKPa'],
      properties: {
        temperatureDegC: { type: 'number' },
        humidityPercentRh: { type: 'number' },
        pressureKPa: { type: 'number' },
      },
    },
    OpResult: {
      type: 'object',
      required: ['state'],
      properties: { state: { type: 'string', description: 'The operational state after the command.' } },
    },
    Quantity: {
      type: 'object',
      required: ['value', 'unit'],
      properties: {
        value: { type: 'number' },
        unit: { type: 'string', description: 'BIPM Digital SI Framework unit URI.' },
      },
    },
    MpeBand: {
      type: 'object',
      required: ['lower', 'upper', 'factor'],
      properties: {
        lower: { type: 'number' },
        upper: { type: ['number', 'null'], description: 'The band upper bound; null for the top band.' },
        factor: { type: 'number' },
      },
    },
  }

  if (signed) {
    schemas['ServeSignature'] = {
      type: 'object',
      description: 'The signed-serve envelope (spec §12 §3.9): the snake_case signature block covering the deep-sorted canonical JSON of { endpoint, register, servedAt, value, unit? }.',
      required: ['algorithm', 'key_id', 'endpoint', 'register', 'signature'],
      properties: {
        algorithm: { type: 'string', enum: ['ECDSA-P256-SHA256'] },
        key_id: { type: 'string' },
        endpoint: { type: 'string' },
        register: { type: 'string' },
        public_key_spki: { type: 'string', description: 'The device public key, SPKI base64url (present on this twin).' },
        signature: { type: 'string', description: 'Base64url of the DER-less (r‖s) signature bytes.' },
      },
    }
    schemas['SignedServedQuantity'] = {
      type: 'object',
      required: ['value', 'unit', 'kind', 'servedAt', 'signature'],
      properties: {
        value: { type: 'number' },
        unit: { type: 'string', description: 'BIPM Digital SI Framework unit URI.' },
        kind: { type: 'string' },
        servedAt: { type: 'string', format: 'date-time', description: 'The serve time, canonical ISO — the signed string.' },
        signature: { $ref: '#/components/schemas/ServeSignature' },
      },
    }
  }

  if (model) {
    Object.assign(schemas, modelMirrorSchemas(model))
  }
  return schemas
}

/** JSON Schemas for the instrument-model mirror — data-driven from the
 *  model's actual keys (the same discipline as generateModelMirror:
 *  no manual field lists to maintain). */
function modelMirrorSchemas(model: InstrumentModel): Record<string, JsonSchema> {
  const schemas: Record<string, JsonSchema> = {}

  schemas['InstrumentIdentification'] = objectSchemaFromSample(model.identification as unknown as Record<string, unknown>)
  if (model.classification) {
    schemas['Classification'] = objectSchemaFromSample(model.classification)
  }
  if (model.designParameters) {
    const properties: Record<string, JsonSchema> = {}
    for (const key of Object.keys(model.designParameters)) {
      properties[snakeToCamel(key)] = { $ref: '#/components/schemas/Quantity' }
    }
    schemas['DesignParameters'] = { type: 'object', properties }
  }
  if (model.metrologicalLimits) {
    const properties: Record<string, JsonSchema> = {}
    const limits = model.metrologicalLimits
    if (limits.mpeBands) properties['mpeBands'] = { type: 'array', items: { $ref: '#/components/schemas/MpeBand' } }
    if (limits.repeatability != null) properties['repeatability'] = { type: ['number', 'null'] }
    if (limits.creepAllowance != null) properties['creepAllowance'] = { type: ['number', 'null'] }
    if (limits.temperatureEffectOnSpan != null) properties['temperatureEffectOnSpan'] = { type: ['number', 'null'] }
    if (limits.temperatureEffectOnZero != null) properties['temperatureEffectOnZero'] = { type: ['number', 'null'] }
    schemas['MetrologicalLimits'] = { type: 'object', properties }
  }
  if (model.provenance) {
    schemas['Provenance'] = objectSchemaFromSample(model.provenance as unknown as Record<string, unknown>)
  }

  const rootProperties: Record<string, JsonSchema> = {
    identification: { $ref: '#/components/schemas/InstrumentIdentification' },
    servedRegisters: {
      type: 'array',
      items: {
        type: 'object',
        required: ['target', 'via', 'returnType'],
        properties: {
          target: { type: 'string' },
          via: { type: 'string' },
          freshWithinS: { type: ['number', 'null'] },
          returnType: { type: 'string' },
        },
      },
    },
    legalOperations: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'kind'],
        properties: { id: { type: 'string' }, kind: { type: 'string', enum: ['query', 'watch', 'command'] } },
      },
    },
  }
  if (model.classification) rootProperties['classification'] = { $ref: '#/components/schemas/Classification' }
  if (model.designParameters) rootProperties['designParameters'] = { $ref: '#/components/schemas/DesignParameters' }
  if (model.metrologicalLimits) rootProperties['metrologicalLimits'] = { $ref: '#/components/schemas/MetrologicalLimits' }
  if (model.provenance) rootProperties['provenance'] = { $ref: '#/components/schemas/Provenance' }
  schemas['InstrumentModel'] = {
    type: 'object',
    required: ['identification', 'servedRegisters', 'legalOperations'],
    properties: rootProperties,
  }
  return schemas
}

/** A JSON Schema object type with one property per key of `sample`
 *  (snake_case → camelCase), typed from the sample's value kinds. */
function objectSchemaFromSample(sample: Record<string, unknown>): JsonSchema {
  const properties: Record<string, JsonSchema> = {}
  for (const [key, value] of Object.entries(sample)) {
    properties[snakeToCamel(key)] = jsonSchemaOf(value)
  }
  return { type: 'object', properties }
}

function jsonSchemaOf(value: unknown): JsonSchema {
  if (typeof value === 'number') return { type: 'number' }
  if (typeof value === 'boolean') return { type: 'boolean' }
  return { type: ['string', 'null'] }
}

/** Generate the OpenAPI 3.1 document for a twin contract. GENERATED,
 *  never hand-written: every path derives from a contract declaration,
 *  so the document cannot drift from the GraphQL leg. */
export function generateTwinOpenApi(contract: TwinContract, opts: TwinOpenApiOptions = {}): Record<string, unknown> {
  const anySigned = opts.signedTargets ? opts.signedTargets.size > 0 : (opts.signed ?? false)
  const signedFor = (target: string): boolean => opts.signedTargets ? opts.signedTargets.has(target) : (opts.signed ?? false)
  const paths: Record<string, unknown> = {}

  for (const serve of contract.serves) {
    const schema = opts.serveSchemas?.[serve.target] ?? serveSchemaRef(serve.target, signedFor(serve.target))
    paths[`/registers/${serve.target}`] = servePathItem(serve.target, serve.via, serve.freshWithinS, schema)
  }
  for (const op of contract.operations) {
    if (op.kind !== 'command') continue
    paths[`/operations/${op.id}`] = {
      post: {
        operationId: op.id,
        summary: `Run the instrument-legal command '${op.id}'.`,
        responses: {
          '200': {
            description: 'The command ran; the answer carries the operational state.',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/OpResult' } } },
          },
        },
      },
    }
  }
  if (contract.model) {
    paths['/instrument'] = {
      get: {
        operationId: 'get_instrument',
        summary: 'The full instrument model mirror (identification, classification, design parameters, metrological limits, provenance).',
        responses: {
          '200': {
            description: "The instrument model — the same object the GraphQL leg's Query.instrument resolves to.",
            content: { 'application/json': { schema: { $ref: '#/components/schemas/InstrumentModel' } } },
          },
        },
      },
    }
  }
  paths['/stream'] = {
    get: {
      operationId: 'stream_twin',
      summary: 'The real-time twin stream: one event per clock advance, carrying the requested targets.',
      parameters: [
        {
          name: 'targets',
          in: 'query',
          required: false,
          schema: { type: 'string' },
          description: "Comma-separated serve targets (default: the contract's serves).",
        },
      ],
      responses: {
        '200': {
          description: 'The Server-Sent Events stream (event: twin).',
          content: { 'text/event-stream': { schema: { type: 'string' } } },
        },
      },
    },
  }

  return {
    openapi: '3.1.0',
    info: {
      title: `${contract.instrumentId} twin API`,
      version: '1.0.0',
      description:
        `The REST projection of the ${contract.instrumentId} twin contract — what a real instrument may ` +
        'legally answer (the epistemic wall: nothing from the world channel appears here). ' +
        'Generated from the baked twin contract; never hand-written.',
    },
    servers: [{ url: '/twin', description: 'The twin channel root.' }],
    paths,
    components: { schemas: componentSchemas(contract.model, anySigned) },
  }
}

/** The OpenAPI leg's conformance gate (law 2, the GraphQL leg's
 *  checkTwinConformance mirrored): every declared serve has its
 *  GET /registers/<target> path, every command op its
 *  POST /operations/<op_id> path, the model mirror its GET /instrument
 *  path, and the document carries no undeclared paths (/stream is the
 *  declared stream documentation). Returns the diff lines
 *  (empty = conformant). */
export function checkOpenApiConformance(doc: Record<string, unknown>, contract: TwinContract): string[] {
  const paths = (doc['paths'] ?? {}) as Record<string, Record<string, unknown>>
  const diffs: string[] = []
  const opKind = new Map(contract.operations.map((o: TwinOperation) => [o.id, o.kind]))

  for (const serve of contract.serves) {
    const item = paths[`/registers/${serve.target}`]
    if (!item?.['get']) {
      diffs.push(`serve '${serve.target}' (via ${serve.via}) needs GET /registers/${serve.target} — not found in the document`)
      continue
    }
    const kind = opKind.get(serve.via) ?? 'query'
    if (kind === 'watch' && !paths['/stream']?.['get']) {
      diffs.push(`watch serve '${serve.target}' needs the documented GET /stream — not found in the document`)
    }
  }
  for (const op of contract.operations) {
    if (op.kind === 'command' && !paths[`/operations/${op.id}`]?.['post']) {
      diffs.push(`command operation '${op.id}' has no POST /operations/${op.id} in the document`)
    }
  }
  if (contract.model && !paths['/instrument']?.['get']) {
    diffs.push('the contract carries an instrument model but the document has no GET /instrument')
  }

  const declared = new Set<string>([
    ...contract.serves.map(s => `/registers/${s.target}`),
    ...contract.operations.filter(o => o.kind === 'command').map(o => `/operations/${o.id}`),
    '/stream',
  ])
  if (contract.model) declared.add('/instrument')
  for (const p of Object.keys(paths)) {
    if (!declared.has(p)) diffs.push(`document path '${p}' is not a declared serve or operation of the contract`)
  }
  return diffs
}
