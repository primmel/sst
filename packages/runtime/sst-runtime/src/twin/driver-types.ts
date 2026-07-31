// twin/driver-types.ts — the type-level machinery that derives the
// TwinDriver<C> method surface from a TwinContract's literal type.
//
// The mapping mirrors generateTwinSchema (packages/core/src/twin-schema.ts)
// exactly:
//   - each serve → a read method (query or watch)
//   - each watch-kind serve → also a subscribe method
//   - each command-kind operation → an invoke method
//
// Field naming: snake_case → camelCase, with `environmental_context`
// mapped to `environmentalContext`. Return type by target:
//   indication → ServedQuantity
//   state → string
//   environmental_context → Environment
//   default → ServedQuantity
//
// Used by TwinDriver<C> in driver.ts. When C is a const-asserted
// contract (LC500_CONTRACT, GAS_ANALYZER_CONTRACT), the mapped types
// produce literal method signatures — typos don't compile, removed
// serves disappear from the surface. When C is the default
// TwinContract, the methods fall back to a dynamic index signature.

import type {
  TwinContract,
  TwinOperation,
  ServeDeclaration,
  InstrumentModel,
  ModelQuantity,
} from '../index.js'
import type { ServedQuantity, Environment, OpResult } from './types.js'

/** snake_case → camelCase (mirrors snakeToCamel at twin-schema.ts:181). */
export type SnakeToCamel<S extends string> =
  S extends `${infer Head}_${infer Tail}`
    ? `${Head}${Capitalize<SnakeToCamel<Tail>>}`
    : S

/** The schema field name for a serve target.
 *  `environmental_context` → `environmentalContext`; otherwise snakeToCamel. */
export type SchemaField<T extends string> =
  T extends 'environmental_context' ? 'environmentalContext' : SnakeToCamel<T>

/** The driver method's return type for a serve target.
 *  Mirrors generateTwinSchema's target → GraphQL-type table. */
export type ServeReturn<T extends string> =
  T extends 'indication' ? ServedQuantity :
  T extends 'state' ? string :
  T extends 'environmental_context' ? Environment :
  ServedQuantity

/** Walk a tuple of TwinOperation to find the kind of the operation
 *  whose id matches `Via`. Returns the default ('query') if not found. */
export type OpKindFor<
  Ops extends readonly TwinOperation[],
  Via extends string,
> = Ops extends readonly [infer Head, ...infer Rest]
  ? Head extends { id: Via; kind: infer K }
    ? K
    : Rest extends readonly TwinOperation[]
      ? OpKindFor<Rest, Via>
      : 'query'
  : 'query'

/** Read methods — one Promise-returning method per serve. Field name
 *  via SchemaField<target>; return type via ServeReturn<target>. */
export type ReadMethods<C extends TwinContract> = {
  [S in C['serves'][number] as SchemaField<S['target'] & string>]:
    () => Promise<ServeReturn<S['target'] & string>>
}

/** Subscribe methods — one per serve whose via-operation is 'watch'.
 *  Method name: `subscribe${Capitalize<SchemaField<target>>}`. Returns
 *  an AsyncIterableIterator of the same type the read method returns. */
export type SubscribeMethods<C extends TwinContract> = {
  [S in C['serves'][number] as OpKindFor<C['operations'], S['via'] & string> extends 'watch'
    ? `subscribe${Capitalize<SchemaField<S['target'] & string>>}`
    : never]:
    () => AsyncIterableIterator<ServeReturn<S['target'] & string>>
}

/** Invoke methods — one per operation of kind 'command'. Method name
 *  via SnakeToCamel<id>. Returns Promise<OpResult>. */
export type InvokeMethods<C extends TwinContract> = {
  [O in C['operations'][number] as O extends { kind: 'command'; id: infer Id }
    ? Id extends string ? SnakeToCamel<Id>
    : never
    : never]:
    () => Promise<OpResult>
}

/** The freshness map — target → freshWithinS. Carried on every driver
 *  so callers can read the contract's freshness promises. */
export type FreshnessMap<C extends TwinContract> = {
  [S in C['serves'][number] as SchemaField<S['target'] & string>]:
    S extends { freshWithinS: infer N } ? N : number | undefined
}

// ── The typed instrument-model response ───────────────────────────────
// When C carries an InstrumentModel, TwinDriver<C> exposes a typed
// `instrument()` method whose return shape is derived from the model.
// Mirrors the runtime resolver: snake_case model keys → camelCase
// response keys; ModelQuantity values pass through unchanged.

/** Convert a single key to its GraphQL field name (environmental_context
 *  → environmentalContext; otherwise snakeToCamel). */
type CameliseKey<K extends string> =
  K extends 'environmental_context' ? 'environmentalContext' : SnakeToCamel<K>

/** Convert all keys of an object literal type to camelCase. The values
 *  pass through unchanged (ModelQuantity stays ModelQuantity, etc.). */
type Camelise<T> = {
  [K in keyof T as K extends string ? CameliseKey<K> : K]: T[K]
}

/** The wire shape of one MPE band (the runtime converts `upper: Infinity`
 *  to `null` since GraphQL Float can't carry Infinity). */
interface MpeBandResponse {
  lower: number
  upper: number | null
  factor: number
}

/** The wire shape of one served-register entry in the model response. */
interface ServedRegisterResponse {
  target: string
  via: string
  freshWithinS?: number
  returnType: string
}

/** Derive the typed response shape for an InstrumentModel. Mirrors the
 *  runtime resolver at twin-schema.ts (generateModelMirror). */
export type TypedInstrumentModelResponse<M extends InstrumentModel> = {
  identification: Camelise<M['identification']>
  classification: M extends { classification: infer C } ? Camelise<C> : null
  designParameters: M extends { designParameters: infer D } ? { [K in keyof D as K extends string ? CameliseKey<K> : K]: ModelQuantity } : null
  metrologicalLimits: M extends { metrologicalLimits: infer ML }
    ? ML extends { mpeBands: unknown }
      ? { mpeBands: MpeBandResponse[] } & Omit<ML, 'mpeBands'>
      : ML
    : null
  provenance: M extends { provenance: infer P } ? Camelise<P> : null
  servedRegisters: ServedRegisterResponse[]
  legalOperations: Array<{ id: string; kind: string }>
}

/** The instrument() method exists on TwinDriver<C> only when C carries
 *  an InstrumentModel. The method returns the typed response derived
 *  from the model type. */
export type InstrumentMethod<C extends TwinContract> =
  C extends { model: infer M }
    ? M extends InstrumentModel
      ? { instrument(): Promise<TypedInstrumentModelResponse<M>> }
      : {}
    : {}

/** The full TwinDriver<C> shape: base + read + subscribe + invoke +
 *  (conditionally) the instrument() method when the model is present. */
export type TwinDriverOfType<C extends TwinContract> = {
  readonly instrumentId: string
  readonly url: string
  readonly contract: C
  readonly freshness: FreshnessMap<C>
  /** Escape hatch: read any register by its raw target id. */
  readRegister(target: string): Promise<unknown>
  /** Drop all active subscriptions. */
  close(): Promise<void>
} & ReadMethods<C> & SubscribeMethods<C> & InvokeMethods<C> & InstrumentMethod<C>

// keep the imports honest
export type { TwinContract, TwinOperation, ServeDeclaration, InstrumentModel }
