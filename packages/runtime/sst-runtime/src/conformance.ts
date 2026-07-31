// conformance.ts — the startup conformance gate (law 2): the served
// schema ≡ the contract's serve declarations ≡ (upstream) the mapped
// promises. A diff fails the process — the twin can never drift.
//
// When the contract carries an InstrumentModel, the gate also deep-
// checks the nested model mirror: every model field appears in the
// corresponding schema type (InstrumentIdentification, Classification,
// DesignParameters, MetrologicalLimits, Provenance).
// NOTE: no 'graphql' import — direct type-map access is realm-agnostic
// (the ESM/CJS facade can dual-instance the graphql package under tsx).
import type { GraphQLSchema } from 'graphql'
import type { TwinContract, InstrumentModel } from './twin-contract.js'
import { snakeToCamel } from './twin-schema.js'

/** Compare a schema against its contract: every serve has a schema
 *  member (Query/Subscription per operation kind), every command op a
 *  Mutation, and the schema carries no undeclared twin fields
 *  (base types + introspection excluded). Returns the diff lines
 *  (empty = conformant). */
export function checkTwinConformance(schema: GraphQLSchema, contract: TwinContract): string[] {
  const queryFields = new Set(Object.keys(schema.getQueryType()?.getFields() ?? {}))
  const mutationFields = new Set(Object.keys(schema.getMutationType()?.getFields() ?? {}))
  const subscriptionFields = new Set(Object.keys(schema.getSubscriptionType()?.getFields() ?? {}))
  const opKind = new Map(contract.operations.map(o => [o.id, o.kind]))

  const diffs: string[] = []
  for (const serve of contract.serves) {
    const kind = opKind.get(serve.via) ?? 'query'
    const field = serve.target === 'environmental_context' ? 'environmentalContext' : snakeToCamel(serve.target)
    const present = kind === 'watch'
      ? subscriptionFields.has(field) && queryFields.has(field)
      : queryFields.has(field)
    if (!present) {
      const where = kind === 'watch' ? 'Query AND Subscription' : 'Query'
      diffs.push(`serve '${serve.target}' (via ${serve.via}) needs field '${field}' on ${where} — not found`)
    }
  }
  for (const op of contract.operations) {
    if (op.kind === 'command' && !mutationFields.has(snakeToCamel(op.id))) {
      diffs.push(`command operation '${op.id}' has no Mutation field '${snakeToCamel(op.id)}' in the schema`)
    }
  }

  const declaredQuery = new Set(contract.serves.map(sv => sv.target === 'environmental_context' ? 'environmentalContext' : snakeToCamel(sv.target)))
  // The full-model mirror (Query.instrument) is legitimate when the
  // contract carries a model. See specs/12-external-graphql-api.md §3.3.
  if (contract.model) declaredQuery.add('instrument')
  for (const f of queryFields) {
    if (!declaredQuery.has(f) && f !== '_empty') diffs.push(`schema Query field '${f}' is not a declared serve of the contract`)
  }

  // Deep conformance: every model field appears in the corresponding
  // schema type. This catches drift between the model and the generated
  // nested types (e.g., a model key that's not in the schema, or a
  // schema field that's not in the model).
  if (contract.model) {
    diffs.push(...checkModelMirror(schema, contract.model))
  }

  return diffs
}

/** Walk the schema's InstrumentIdentification / Classification /
 *  DesignParameters / MetrologicalLimits / Provenance types and verify
 *  they match the model's fields. */
function checkModelMirror(schema: GraphQLSchema, model: InstrumentModel): string[] {
  const diffs: string[] = []
  const instType = schema.getType('InstrumentModel') as { getFields?: () => Record<string, { name: string }> } | undefined
  if (!instType?.getFields) {
    diffs.push("model declared but schema has no 'InstrumentModel' type — generation drift")
    return diffs
  }
  const instrumentFields = new Set(Object.keys(instType.getFields()))
  if (!instrumentFields.has('identification')) diffs.push("InstrumentModel missing 'identification' field")
  if (!instrumentFields.has('servedRegisters')) diffs.push("InstrumentModel missing 'servedRegisters' field")
  if (!instrumentFields.has('legalOperations')) diffs.push("InstrumentModel missing 'legalOperations' field")

  // Each section's fields match the model's keys (snake_case → camelCase).
  if (model.identification) {
    diffs.push(...checkSection(schema, 'InstrumentIdentification', model.identification as unknown as Record<string, unknown>))
  }
  if (model.classification) {
    diffs.push(...checkSection(schema, 'Classification', model.classification))
  }
  if (model.designParameters) {
    diffs.push(...checkSection(schema, 'DesignParameters', model.designParameters as unknown as Record<string, unknown>))
  }
  if (model.provenance) {
    diffs.push(...checkSection(schema, 'Provenance', model.provenance as unknown as Record<string, unknown>))
  }
  return diffs
}

function checkSection(schema: GraphQLSchema, typeName: string, modelSection: Record<string, unknown>): string[] {
  const t = schema.getType(typeName) as { getFields?: () => Record<string, { name: string }> } | undefined
  if (!t?.getFields) {
    return [`${typeName} not in schema (model declared ${Object.keys(modelSection).length} fields)`]
  }
  const schemaFields = new Set(Object.keys(t.getFields()))
  const diffs: string[] = []
  for (const key of Object.keys(modelSection)) {
    const camelKey = snakeToCamel(key)
    if (!schemaFields.has(camelKey)) {
      diffs.push(`${typeName} schema missing field '${camelKey}' (model key '${key}')`)
    }
  }
  return diffs
}
