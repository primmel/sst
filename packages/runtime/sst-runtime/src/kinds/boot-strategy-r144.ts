// kinds/boot-strategy-r144.ts — the R 144 (gas analyzer) boot strategy.
// Plug-and-play path preferred; legacy SimulatedGasAnalyzer as fallback.

import { SimulatedGasAnalyzer, type GasComponent } from '../gas-instrument.js'
import { getGasScenario } from '../gas-scenario.js'
import type { TwinIo } from '../twin-schema.js'
import { buildWorldSchemaFromKind } from './world-schema-assembler.js'
import { tryBootFromBehavior } from './boot-from-behavior.js'
import { buildGasWorldSchema, type GasWorldContext } from '../gas-world.js'
import {
  registerKindBootStrategy,
  type KindBootContext,
  type KindBootResult,
  type KindBootStrategy,
} from './boot-strategy.js'

async function bootR144(ctx: KindBootContext): Promise<KindBootResult> {
  const { instance, clock, seed, kindDir, classification, coefficients, physicsChain, sample } = ctx

  if (kindDir) {
    const plug = await tryBootFromBehavior({
      instance, clock, seed, classification, coefficients, kindDir,
      ...(physicsChain ? { physicsChain } : {}),
      ...(sample ? { sample } : {}),
    }).catch((err) => {
      if ((err as Error).message?.includes('no behavior module')) return null
      throw err
    })
    if (plug) {
      return { instrument: plug.instrument, worldSchema: plug.worldSchema, behavior: plug.behavior }
    }
  }

  const scenarioName = (instance.manifest.classification?.scenario as string | undefined) ?? 'good-analyzer'
  const scenario = getGasScenario(scenarioName)
  const instrument = new SimulatedGasAnalyzer(scenario, clock, seed)
  const host: GasWorldContext = {
    instrument,
    clock,
    swap(def) { this.instrument = new SimulatedGasAnalyzer(def, clock, seed) },
  }
  const worldSchema = kindDir
    ? await buildWorldSchemaFromKind(kindDir, host as never, {} as never).catch(() => buildGasWorldSchema(host))
    : buildGasWorldSchema(host)

  const served = (component: GasComponent) => {
    const q = instrument.indication(component)
    return { value: q.value, unit: q.unit, kind: q.kind, servedAt: instrument.servedAt() }
  }
  const twinIo: TwinIo = {
    get instrument() { return instrument as never },
    clock,
    registers: {
      indication_co: () => served('co'),
      indication_nox: () => served('nox'),
    },
    operations: {
      zero_calibration: () => instrument.zeroCalibration(),
      span_calibration: () => instrument.spanCalibration(),
    },
  }
  return { instrument, worldSchema, twinIo }
}

const R144_BOOT_STRATEGY: KindBootStrategy = {
  kindId: 'primmel-sst-r144',
  boot: bootR144,
}
registerKindBootStrategy(R144_BOOT_STRATEGY)

export { bootR144, R144_BOOT_STRATEGY }
