// kinds/twin-io-builder.ts — build TwinIo from a running instrument +
// the contract's serve/operation declarations.
//
// Model-driven: the contract declares what is served; this builder
// resolves each serve target to a reader on the instrument via
// well-known conventions (and optional behavior.twinRegisters).
//
// Core targets (indication, state, environmental_context) are handled
// by generateTwinSchema's readerFor — they need only the instrument
// surface. Non-core targets need TwinIo.registers.

import type { VirtualClock } from '../time.js'
import type { TwinIo, TwinInstrumentView } from '../twin-schema.js'
import { snakeToCamel } from '../twin-schema.js'
import type { TwinContract } from '../twin-contract.js'
import type { LoadedBehavior } from './behavior-loader.js'

const CORE_TARGETS = new Set(['indication', 'state', 'environmental_context'])

/**
 * Build a TwinIo for generateTwinSchema from a running instrument.
 *
 * Resolution order for non-core serve targets:
 *   1. behavior.twinRegisters(instrument) if provided
 *   2. Convention-based auto-discovery on the instrument surface
 */
export function buildTwinIo(
  instrument: unknown,
  clock: VirtualClock,
  contract: TwinContract,
  behavior?: LoadedBehavior,
): TwinIo {
  const inst = instrument as TwinInstrumentView & Record<string, unknown>

  // 1. Prefer explicit twinRegisters from the behavior.
  let registers: Record<string, () => unknown> = {}
  if (behavior?.twinRegisters) {
    registers = { ...behavior.twinRegisters(instrument) }
  }

  // 2. Auto-discover any missing non-core serves.
  for (const serve of contract.serves) {
    if (CORE_TARGETS.has(serve.target)) continue
    if (registers[serve.target]) continue
    const reader = autoRegisterReader(inst, serve.target)
    if (reader) registers[serve.target] = reader
  }

  // 3. Operations — prefer behavior.twinOperations, else auto from
  //    camelCased method names on the instrument (run_self_test → runSelfTest/selfTest).
  let operations: Record<string, () => void> = {}
  if (behavior?.twinOperations) {
    operations = { ...behavior.twinOperations(instrument) }
  }
  for (const op of contract.operations) {
    if (op.kind !== 'command') continue
    if (operations[op.id]) continue
    const fn = autoOperation(inst, op.id)
    if (fn) operations[op.id] = fn
  }

  return {
    get instrument() { return inst },
    clock,
    ...(Object.keys(registers).length ? { registers } : {}),
    ...(Object.keys(operations).length ? { operations } : {}),
  }
}

function autoRegisterReader(
  inst: Record<string, unknown>,
  target: string,
): (() => unknown) | null {
  const servedAt = () => {
    const fn = inst.servedAt
    return typeof fn === 'function' ? (fn as () => number).call(inst) : 0
  }
  const toServed = (q: { value: number; unit: string; kind?: string }) => ({
    value: q.value,
    unit: q.unit,
    kind: q.kind ?? 'quantity',
    servedAt: servedAt(),
  })

  // indication_<component> → indication(component) | indicationFor(component)
  //                         | dimensionsCm().<component>Cm
  if (target.startsWith('indication_')) {
    const component = target.slice('indication_'.length) // co | nox | length | width | height

    // Dimension axes first (R 129): dimensionsCm().lengthCm etc.
    // Must precede indication() — MD.indication() returns SI metres and
    // ignores a component argument.
    const dimensionsCm = inst.dimensionsCm
    if (typeof dimensionsCm === 'function' && ['length', 'width', 'height'].includes(component)) {
      const key = `${component}Cm`
      return () => {
        const d = (dimensionsCm as () => Record<string, number>).call(inst)
        return { value: d[key] ?? 0, unit: 'cm', kind: 'length', servedAt: servedAt() }
      }
    }

    // Prefer indicationFor when present (explicit multi-channel API).
    const indicationFor = inst.indicationFor
    if (typeof indicationFor === 'function') {
      return () => toServed((indicationFor as (c: string) => { value: number; unit: string; kind?: string }).call(inst, component))
    }
    // indication(component) for multi-channel instruments (R 144 gas).
    const indication = inst.indication
    if (typeof indication === 'function') {
      try {
        const probe = (indication as (c?: string) => unknown).call(inst, component)
        if (probe && typeof probe === 'object' && 'value' in (probe as object)) {
          // Only treat as multi-channel if the component arg changes the result
          // vs the no-arg call, OR if component looks like a gas species.
          if (['co', 'nox', 'no', 'no2', 'so2', 'o3', 'ch4', 'co2'].includes(component.toLowerCase())) {
            return () => toServed((indication as (c: string) => { value: number; unit: string; kind?: string }).call(inst, component))
          }
        }
      } catch { /* fall through */ }
    }
  }

  // dim_volume → volumeCm3()
  if (target === 'dim_volume') {
    const volumeCm3 = inst.volumeCm3
    if (typeof volumeCm3 === 'function') {
      return () => ({ value: (volumeCm3 as () => number).call(inst), unit: 'cm3', kind: 'volume', servedAt: servedAt() })
    }
  }

  // dim_weight → dimWeightKg()
  if (target === 'dim_weight') {
    const dimWeightKg = inst.dimWeightKg
    if (typeof dimWeightKg === 'function') {
      return () => ({ value: (dimWeightKg as () => number).call(inst), unit: 'kg', kind: 'mass', servedAt: servedAt() })
    }
  }

  // Generic: camelCased method returning Qty or ServedQuantity.
  const method = snakeToCamel(target)
  const fn = inst[method]
  if (typeof fn === 'function') {
    return () => {
      const v = (fn as () => unknown).call(inst)
      if (v && typeof v === 'object' && 'value' in (v as object)) {
        const q = v as { value: number; unit: string; kind?: string; servedAt?: number }
        return { value: q.value, unit: q.unit, kind: q.kind ?? 'quantity', servedAt: q.servedAt ?? servedAt() }
      }
      return v
    }
  }

  return null
}

function autoOperation(inst: Record<string, unknown>, opId: string): (() => void) | null {
  const camel = snakeToCamel(opId) // run_self_test → runSelfTest
  // Also try selfTest (common shorthand).
  const candidates = [camel, camel.replace(/^run/, '').replace(/^./, (c) => c.toLowerCase())]
  // runSelfTest → selfTest
  if (camel.startsWith('run') && camel.length > 3) {
    candidates.push(camel.slice(3, 4).toLowerCase() + camel.slice(4)) // SelfTest → selfTest
  }
  for (const name of candidates) {
    const fn = inst[name]
    if (typeof fn === 'function') {
      return () => { (fn as () => void).call(inst) }
    }
  }
  return null
}
