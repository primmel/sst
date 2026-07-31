// kinds/boot-strategy-r91.ts — the R 91 (radar) boot strategy.
// Plug-and-play path preferred; legacy RadarSpeedMeter as fallback.

import { mulberry32 } from '../physics/rng.js'
import { RadarSpeedMeter } from '@sim/r91/instrument'
import { getR91Scenario } from '@sim/r91/scenarios'
import { buildR91WorldSchema, type R91WorldContext } from '@sim/r91/world'
import type { TwinIo } from '../twin-schema.js'
import { buildWorldSchemaFromKind } from './world-schema-assembler.js'
import { tryBootFromBehavior } from './boot-from-behavior.js'
import {
  registerKindBootStrategy,
  type KindBootContext,
  type KindBootResult,
  type KindBootStrategy,
} from './boot-strategy.js'

async function bootR91(ctx: KindBootContext): Promise<KindBootResult> {
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

  const scenarioName = (instance.manifest.classification?.scenario as string | undefined) ?? 'good-radar'
  const scenario = getR91Scenario(scenarioName)
  const rng = mulberry32(seed)
  const instrument = new RadarSpeedMeter(scenario, clock, rng)
  const host: R91WorldContext = {
    instrument,
    clock,
    swap(def) { this.instrument = new RadarSpeedMeter(def, clock, mulberry32(seed)) },
  }
  const worldSchema = kindDir
    ? await buildWorldSchemaFromKind(kindDir, host as never, {} as never).catch(() => buildR91WorldSchema(host))
    : buildR91WorldSchema(host)
  const twinIo: TwinIo = {
    get instrument() { return instrument as never },
    clock,
    operations: { run_self_test: () => instrument.selfTest() },
  }
  return { instrument, worldSchema, twinIo }
}

const R91_BOOT_STRATEGY: KindBootStrategy = {
  kindId: 'primmel-sst-r91',
  boot: bootR91,
}
registerKindBootStrategy(R91_BOOT_STRATEGY)

export { bootR91, R91_BOOT_STRATEGY }
