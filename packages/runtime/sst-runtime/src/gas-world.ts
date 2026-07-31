// gas-world.ts — the R 144 gas bench's /world channel: the generic
// builder (world-schema.ts) + the gas kind. Every mutation realizes
// THROUGH the physics stages (transduction/conditioning) — there is no
// path from /world to the indication but the signal chain.
import type { GraphQLSchema } from 'graphql'
import { buildWorldSchemaFor, type WorldContext, type WorldKind } from './world-schema.js'
import type { SimulatedGasAnalyzer, GasAnalyzerDefinition, GasComponent } from './gas-instrument.js'
import { GAS_SCENARIOS } from './gas-scenario.js'

export type GasWorldContext = WorldContext<SimulatedGasAnalyzer, GasAnalyzerDefinition>

/** The gas-bench kind (instrument family #2): gas composition per
 *  component, interferents, sample flow, and the physically-realized
 *  faults (contaminated optics, source aging, sample-line leak). */
export const GAS_WORLD_KIND: WorldKind<SimulatedGasAnalyzer, GasAnalyzerDefinition> = {
  types: /* GraphQL */ `
    type GasBench {
      coPpm: Float!
      noxPpm: Float!
      no2Fraction: Float!
      co2PercentVol: Float!
      h2oPercentVol: Float!
      flowLPerMin: Float!
      sampleLineLeakFraction: Float!
    }
    type ChannelTruth {
      rawSignal: Float!
      zeroRefRaw: Float!
      spanRefPerPpm: Float!
      zeroDriftPpm: Float!
      spanDriftFraction: Float!
      contamination: Float!
      agingDriftAU: Float!
    }
    type GasChannels { co: ChannelTruth!, nox: ChannelTruth! }
    type GroundTruth {
      clockS: Float!
      environment: Environment!
      bench: GasBench!
      channels: GasChannels!
      faultLatched: Boolean!
    }
  `,
  mutationFields: /* GraphQL */ `
    setGasConcentration(component: String!, ppm: Float!): WorldState!
    setNo2Fraction(fraction: Float!): WorldState!
    setInterferents(co2PercentVol: Float, h2oPercentVol: Float): WorldState!
    setSampleFlow(lPerMin: Float!): WorldState!
    setOpticsContamination(fraction: Float!): WorldState!
    setSourceAgingRate(perDay: Float!): WorldState!
    setSampleLineLeak(fraction: Float!): WorldState!
  `,
  scenarios: Object.fromEntries(Object.values(GAS_SCENARIOS).map(s => [s.name, { name: s.name, description: s.description, definition: s }])),
  groundTruth: ctx => ctx.instrument.groundTruth(),
  mutations: {
    setGasConcentration: (ctx, args) => {
      const a = args as { component: GasComponent; ppm: number }
      ctx.instrument.setGasConcentration(a.component, a.ppm)
    },
    setNo2Fraction: (ctx, args) => { ctx.instrument.setNo2Fraction((args as { fraction: number }).fraction) },
    setInterferents: (ctx, args) => { ctx.instrument.setInterferents(args as { co2PercentVol?: number; h2oPercentVol?: number }) },
    setSampleFlow: (ctx, args) => { ctx.instrument.setSampleFlow((args as { lPerMin: number }).lPerMin) },
    setOpticsContamination: (ctx, args) => { ctx.instrument.setOpticsContamination((args as { fraction: number }).fraction) },
    setSourceAgingRate: (ctx, args) => { ctx.instrument.setSourceAgingRate((args as { perDay: number }).perDay) },
    setSampleLineLeak: (ctx, args) => { ctx.instrument.setSampleLineLeak((args as { fraction: number }).fraction) },
  },
}

/** The gas analyzer's /world channel. */
export function buildGasWorldSchema(ctx: GasWorldContext): GraphQLSchema {
  return buildWorldSchemaFor(ctx, GAS_WORLD_KIND)
}
