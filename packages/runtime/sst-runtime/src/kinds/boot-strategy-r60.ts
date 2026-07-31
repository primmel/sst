// kinds/boot-strategy-r60.ts — the R 60 (load cell) boot strategy.
//
// Plug-and-play path (preferred): load instance behavior.js → create()
// → assemble world schema from kind YAML/SDL/handlers.
//
// Legacy path (fallback): construct ComposedInstrument from the
// data-driven physics chain + coefficients.

import { buildWorldSchema } from '../world-schema.js'
import { buildWorldSchemaFromKind } from './world-schema-assembler.js'
import { tryBootFromBehavior } from './boot-from-behavior.js'
import { ComposedInstrument, type ComposedInstrumentConfig } from '../stages/composer.js'
import type { Environment } from '../instrument.js'
import type { Qty } from '../physics/quantity.js'
import {
  registerKindBootStrategy,
  type KindBootContext,
  type KindBootResult,
  type KindBootStrategy,
} from './boot-strategy.js'

/** Legacy adapter: LOAD_CELL_WORLD_KIND expects setLoad/removeLoad. */
interface R60HostInstrument {
  setLoad(massKg: number): void
  removeLoad(): void
  setEnvironment(e: Partial<Environment>): void
  setFidelity(k: { servedOffsetKg?: number; servedLagS?: number }): void
  resetFidelity(): void
  injectFault(): void
  clearFault(): void
  reset(): void
  indication(): Qty
  servedAt(): number
  operationalState(): string
  environment(): Environment
  groundTruth(): {
    appliedLoadKg: number
    strainMm: number
    clockS: number
    spanDriftFraction: number
    thermalOffsetMVperV: number
    environment: Environment
  }
  readonly thermalHysteresis: { tauS: number }
  setThermalHysteresis(perDegC: number, tauS: number): void
}

function adaptR60Instrument(composed: ComposedInstrument): R60HostInstrument {
  let thermalHysteresisTauS = 3600
  return {
    setLoad: (kg) => composed.placeMass(kg),
    removeLoad: () => composed.removeMass(),
    setEnvironment: (e) => composed.setEnvironment(e),
    setFidelity: (k) => composed.setFidelity(k),
    resetFidelity: () => composed.resetFidelity(),
    injectFault: () => composed.injectFault(),
    clearFault: () => composed.clearFault(),
    reset: () => composed.reset(),
    indication: () => composed.indication(),
    servedAt: () => composed.servedAt(),
    operationalState: () => composed.operationalState(),
    environment: () => composed.environment(),
    groundTruth: () => composed.groundTruth(),
    get thermalHysteresis() { return { tauS: thermalHysteresisTauS } },
    setThermalHysteresis(_perDegC, tauS) { thermalHysteresisTauS = tauS },
  }
}

async function bootR60(ctx: KindBootContext): Promise<KindBootResult> {
  const { classification, coefficients, physicsChain, clock, seed, kindDir, instance, sample } = ctx

  // ── Plug-and-play path ──────────────────────────────────────────────
  if (kindDir) {
    const plug = await tryBootFromBehavior({
      instance,
      clock,
      seed,
      classification,
      coefficients,
      kindDir,
      ...(physicsChain ? { physicsChain } : {}),
      ...(sample ? { sample } : {}),
    }).catch((err) => {
      // Behavior present but broken — surface the error (don't silently fall back).
      if ((err as Error).message?.includes('no behavior module')) return null
      throw err
    })
    if (plug) {
      return {
        instrument: plug.instrument,
        worldSchema: plug.worldSchema,
        behavior: plug.behavior,
      }
    }
  }

  // ── Legacy path: data-driven ComposedInstrument ─────────────────────
  const config: ComposedInstrumentConfig = {
    classification: {
      construction: classification.construction ?? 'column',
      technology: classification.technology ?? 'strain-gauge',
      stack: classification.stack ?? 'digital',
    },
    coefficients,
    ...(physicsChain ? { physicsChain } : {}),
  }
  const composed = new ComposedInstrument(config, clock, seed)
  const useAssembler = !!kindDir
  const hostInstrument = useAssembler ? composed : adaptR60Instrument(composed)
  const host = {
    instrument: hostInstrument,
    clock,
    swap() { /* scenarios are not swappable in the SST runtime */ },
  }
  const worldSchema = useAssembler
    ? await buildWorldSchemaFromKind(kindDir!, host as never, {} as never)
    : buildWorldSchema(host as never)

  return {
    instrument: composed,
    worldSchema,
    twinIo: { get instrument() { return hostInstrument as never }, clock },
  }
}

const R60_BOOT_STRATEGY: KindBootStrategy = {
  kindId: 'primmel-sst-r60',
  boot: bootR60,
}
registerKindBootStrategy(R60_BOOT_STRATEGY)

export { bootR60, adaptR60Instrument, R60_BOOT_STRATEGY }
