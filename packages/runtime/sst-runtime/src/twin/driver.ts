// twin/driver.ts — the typed client API for a running instrument's
// /twin endpoint. Generated from the same TwinContract that drives
// the server-side generateTwinSchema — closing the model-driven loop
// on the client side.
//
// The contract → driver mapping (mirrors generateTwinSchema exactly):
//   - each `serve` whose via-operation is `query`  → a Promise-returning read method
//   - each `serve` whose via-operation is `watch`  → a read method + a subscribe method
//                                                    returning AsyncIterableIterator
//   - each `operation` of kind `command`           → a Promise-returning invoke method
//
// Method names: snakeToCamel(serve.target) / snakeToCamel(operation.id),
// with `environmental_context` → `environmentalContext`.
//
// The type-level surface (TwinDriverOfType<C>) is derived from the
// contract type via TypeScript mapped types — see driver-types.ts.
// Callers passing a const-asserted contract (LC500_CONTRACT) get
// compile-time method checking; callers passing a generic TwinContract
// get the dynamic index signature.

import type { TwinContract, TwinOperation } from '../index.js'
import { snakeToCamel } from '../twin-schema.js'
import { gql, subscribe } from './transport.js'
import { checkFreshness } from './freshness.js'
import type { DriverOpts, Environment, OpResult, ServedQuantity } from './types.js'
import type { TwinDriverOfType } from './driver-types.js'

/** The typed driver surface, parameterised by the contract type. When
 *  C is a const-asserted contract, the method signatures are derived
 *  literally. When C is the default, falls back to a dynamic surface. */
export type TwinDriver<C extends TwinContract = TwinContract> = TwinDriverOfType<C>

/** Construct a TwinDriver from a contract + URL. */
export function createTwinDriver<C extends TwinContract>(
  contract: C,
  url: string,
  opts?: DriverOpts,
): TwinDriver<C> {
  const subs: Array<() => void> = []
  const driver: Record<string, unknown> = {
    instrumentId: contract.instrumentId,
    url,
    contract,
    freshness: Object.fromEntries(
      contract.serves.map((s) => [schemaFieldName(s.target), s.freshWithinS]),
    ),
    readRegister(target: string) {
      return readRegisterImpl(url, target, opts)
    },
    close: async () => { for (const off of subs.splice(0)) await off() },
  }

  const opKind = new Map(contract.operations.map((o: TwinOperation) => [o.id, o.kind]))
  for (const serve of contract.serves) {
    const field = schemaFieldName(serve.target)
    driver[field] = async function () {
      return readServe(url, serve.target, serve.freshWithinS, opts)
    }
    if (opKind.get(serve.via) === 'watch') {
      const subName = `subscribe${field[0]!.toUpperCase()}${field.slice(1)}`
      driver[subName] = function () {
        const selection = selectionForTarget(serve.target)
        const queryTarget = rawFieldName(serve.target)
        const it = subscribe(`${url}/twin`, `subscription { ${queryTarget} ${selection} }`, { fetch: opts?.fetch })
        subs.push(() => { it.return?.(undefined as never) })
        return it
      }
    }
  }
  for (const op of contract.operations) {
    if (op.kind !== 'command') continue
    const name = snakeToCamel(op.id)
    driver[name] = async function (args?: Record<string, unknown>): Promise<OpResult> {
      const argsStr = args && Object.keys(args).length > 0
        ? `(${Object.entries(args).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join(', ')})`
        : ''
      const gqlField = snakeToCamel(op.id)
      const data = await gql(`${url}/twin`, `mutation { ${gqlField}${argsStr} { state } }`, { fetch: opts?.fetch })
      return data[gqlField] as OpResult
    }
  }

  // The instrument-model mirror: when the contract carries a model,
  // expose a typed `instrument()` method that fetches the full
  // InstrumentModel. The query selects every nested field the runtime
  // resolver knows how to populate (mirrors generateModelMirror).
  if (contract.model) {
    driver.instrument = async function (): Promise<unknown> {
      const data = await gql(`${url}/twin`, `{ instrument ${instrumentSelection(contract)} }`, { fetch: opts?.fetch })
      return (data as Record<string, unknown>).instrument
    }
  }

  return driver as TwinDriver<C>
}

/** Build the GraphQL selection for `Query.instrument` based on which
 *  model sections the contract carries. Each section's sub-selection
 *  mirrors the runtime resolver's response shape. */
function instrumentSelection(contract: TwinContract): string {
  const model = contract.model
  if (!model) return ''
  const parts: string[] = []
  // Identification — select every declared key (camelCased).
  parts.push(`identification { ${Object.keys(model.identification).map(snakeToCamel).join(' ')} }`)
  if (model.classification) {
    parts.push(`classification { ${Object.keys(model.classification).map(snakeToCamel).join(' ')} }`)
  }
  if (model.designParameters) {
    // Each design parameter is a Quantity — needs its own { value unit } sub-selection.
    const each = Object.keys(model.designParameters).map((k) => `${snakeToCamel(k)} { value unit }`).join(' ')
    parts.push(`designParameters { ${each} }`)
  }
  if (model.metrologicalLimits) {
    const limitFields: string[] = []
    if (model.metrologicalLimits.mpeBands) limitFields.push('mpeBands { lower upper factor }')
    if (model.metrologicalLimits.repeatability != null) limitFields.push('repeatability')
    if (model.metrologicalLimits.creepAllowance != null) limitFields.push('creepAllowance')
    if (model.metrologicalLimits.temperatureEffectOnSpan != null) limitFields.push('temperatureEffectOnSpan')
    if (model.metrologicalLimits.temperatureEffectOnZero != null) limitFields.push('temperatureEffectOnZero')
    if (limitFields.length > 0) parts.push(`metrologicalLimits { ${limitFields.join(' ')} }`)
  }
  if (model.provenance) {
    parts.push(`provenance { ${Object.keys(model.provenance).map(snakeToCamel).join(' ')} }`)
  }
  parts.push('servedRegisters { target via freshWithinS returnType }')
  parts.push('legalOperations { id kind }')
  return `{ ${parts.join(' ')} }`
}

async function readServe(
  url: string,
  target: string,
  freshWithinS: number | undefined,
  opts?: DriverOpts,
): Promise<unknown> {
  const selection = selectionForTarget(target)
  const queryTarget = rawFieldName(target)
  const data = await gql(`${url}/twin`, `{ ${queryTarget} ${selection} }`, { fetch: opts?.fetch })
  const value = (data as Record<string, unknown>)[queryTarget]
  if (typeof value === 'object' && value !== null && 'servedAt' in value) {
    checkFreshness(target, (value as { servedAt: number }).servedAt, freshWithinS, opts)
  }
  return value
}

async function readRegisterImpl(url: string, target: string, opts?: DriverOpts): Promise<unknown> {
  const data = await gql(`${url}/twin`, `{ ${target} }`, { fetch: opts?.fetch })
  return (data as Record<string, unknown>)[target]
}

/** The GraphQL field name for a serve target — environmental_context →
 *  environmentalContext; otherwise the raw target. The selection's
 *  outer field name uses the raw form because the GraphQL schema
 *  generator uses the same logic. */
function rawFieldName(target: string): string {
  return target === 'environmental_context' ? 'environmentalContext' : snakeToCamel(target)
}

/** The TS-driver method name for a serve target — snakeToCamel applied. */
function schemaFieldName(target: string): string {
  return target === 'environmental_context' ? 'environmentalContext' : snakeToCamel(target)
}

/** The GraphQL sub-selection for a serve target — chooses the fields
 *  appropriate for the return type. */
function selectionForTarget(target: string): string {
  if (target === 'indication') return '{ value unit kind servedAt }'
  if (target === 'environmental_context') return '{ temperatureDegC humidityPercentRh pressureKPa }'
  if (target === 'state') return ''
  // Default: assume ServedQuantity shape.
  return '{ value unit kind servedAt }'
}

export type { ServedQuantity, Environment, OpResult, DriverOpts }
