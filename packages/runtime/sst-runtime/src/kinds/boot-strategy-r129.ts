// kinds/boot-strategy-r129.ts — the R 129 (dimensioner) boot strategy.
// Plug-and-play path preferred; legacy MultiDimensionalInstrument as fallback.

import { mulberry32 } from '../physics/rng.js'
import { MultiDimensionalInstrument } from '@sim/md/instrument'
import { getMdScenario } from '@sim/md/scenarios'
import { buildMdWorldSchema, type MdWorldContext } from '@sim/md/world'
import type { TwinIo } from '../twin-schema.js'
import { buildWorldSchemaFromKind } from './world-schema-assembler.js'
import { tryBootFromBehavior } from './boot-from-behavior.js'
import {
  registerKindBootStrategy,
  type KindBootContext,
  type KindBootResult,
  type KindBootStrategy,
} from './boot-strategy.js'

async function bootR129(ctx: KindBootContext): Promise<KindBootResult> {
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

  const scenarioName = (instance.manifest.classification?.scenario as string | undefined) ?? 'good-dimensioner'
  const scenario = getMdScenario(scenarioName)
  const rng = mulberry32(seed)
  const instrument = new MultiDimensionalInstrument(scenario, clock, rng)
  const host: MdWorldContext = {
    instrument,
    clock,
    swap(def) { this.instrument = new MultiDimensionalInstrument(def, clock, mulberry32(seed)) },
  }
  const worldSchema = kindDir
    ? await buildWorldSchemaFromKind(kindDir, host as never, {} as never).catch(() => buildMdWorldSchema(host))
    : buildMdWorldSchema(host)

  const dims = () => instrument.dimensionsCm()
  const servedAt = () => instrument.servedAt()
  const twinIo: TwinIo = {
    get instrument() { return instrument as never },
    clock,
    registers: {
      indication_length: () => ({ value: dims().lengthCm, unit: 'cm', kind: 'length', servedAt: servedAt() }),
      indication_width:  () => ({ value: dims().widthCm,  unit: 'cm', kind: 'length', servedAt: servedAt() }),
      indication_height: () => ({ value: dims().heightCm, unit: 'cm', kind: 'length', servedAt: servedAt() }),
      dim_volume:        () => ({ value: instrument.volumeCm3(), unit: 'cm³', kind: 'volume', servedAt: servedAt() }),
      dim_weight:        () => ({ value: instrument.dimWeightKg(), unit: 'kg', kind: 'mass', servedAt: servedAt() }),
    },
    operations: { run_self_test: () => instrument.selfTest() },
  }
  return { instrument, worldSchema, twinIo }
}

const R129_BOOT_STRATEGY: KindBootStrategy = {
  kindId: 'primmel-sst-r129',
  boot: bootR129,
}
registerKindBootStrategy(R129_BOOT_STRATEGY)

export { bootR129, R129_BOOT_STRATEGY }
