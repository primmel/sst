// world-schema.ts — the simulated-actions channel (spec §7): the
// out-of-band physical world. Certification software never uses this
// channel (the epistemic wall, law 1) — it is simulated reality.
//
// The builder is GENERIC over the instrument kind (the multi-instrument
// design): core owns the shared surface (clock, D 11 profiles,
// environment, scenario swap, reset, the fault latch); each instrument
// kind contributes its GroundTruth shape, its scenario registry, and
// its actuation vocabulary as a WorldKind (the load cell below; the
// R 144 gas analyzer in gas-world.ts).
import { createSchema } from 'graphql-yoga'
import type { GraphQLSchema } from 'graphql'
import type { VirtualClock } from './time.js'
import type { SimulatedInstrument, InstrumentDefinition, Environment } from './instrument.js'
import { SCENARIOS } from './scenario.js'
import { D11_PROFILES, ProfilePlayer } from './environment/profiles.js'

/** The instrument surface the generic world surface needs. */
export interface WorldInstrument {
  setEnvironment(e: Partial<Environment>): void
  injectFault(): void
  clearFault(): void
  reset(): void
}

/** The instrument lifecycle host: the schema mutates the world through
 *  this (the server owns the concrete instance; scenario() swaps it). */
export interface WorldContext<I extends WorldInstrument = SimulatedInstrument, D = InstrumentDefinition> {
  instrument: I
  clock: VirtualClock
  swap(def: D): void
  /** current D 11 profile player, if any (server-managed). */
  player?: ProfilePlayer | undefined
}

/** An instrument kind's contribution to its /world channel. */
export interface WorldKind<I extends WorldInstrument, D> {
  /** SDL: the kind's GroundTruth type plus any supporting types/inputs. */
  types: string
  /** SDL: the kind's Mutation fields (its actuation vocabulary). */
  mutationFields: string
  /** the kind's scenario registry (name → definition + blurb). */
  scenarios: Record<string, { name: string; description: string; definition: D }>
  /** reality, /world only. */
  groundTruth(ctx: WorldContext<I, D>): unknown
  /** the kind's actuation handlers: each mutates the world (through the
   *  physics); the builder answers WorldState. */
  mutations: Record<string, (ctx: WorldContext<I, D>, args: Record<string, unknown>) => void>
}

function worldState<I extends WorldInstrument, D>(ctx: WorldContext<I, D>, kind: WorldKind<I, D>) {
  return { clock: ctx.clock.now(), mode: ctx.clock.mode(), groundTruth: kind.groundTruth(ctx) }
}

const CORE_TYPES = /* GraphQL */ `
  type Environment { temperatureDegC: Float!, humidityPercentRh: Float!, pressureKPa: Float! }
  type WorldState { clock: Float!, mode: String!, groundTruth: GroundTruth! }
  type ScenarioInfo { name: String!, description: String! }
  type ProfileInfo { id: String!, standard: String! }
  input EnvironmentInput { temperatureDegC: Float, humidityPercentRh: Float, pressureKPa: Float }
`

const CORE_MUTATIONS = /* GraphQL */ `
  setEnvironment(conditions: EnvironmentInput!): WorldState!
  playProfile(profile: String!): WorldState!
  advanceTime(seconds: Float!): WorldState!
  setClockMode(mode: String!): WorldState!
  scenario(name: String!): WorldState!
  injectFault: WorldState!
  clearFault: WorldState!
  reset: WorldState!
`

export function buildWorldSchemaFor<I extends WorldInstrument, D>(ctx: WorldContext<I, D>, kind: WorldKind<I, D>): GraphQLSchema {
  const typeDefs = /* GraphQL */ `
    ${CORE_TYPES}
    ${kind.types}
    type Query {
      clock: Float!
      groundTruth: GroundTruth!
      worldState: WorldState!
      scenarios: [ScenarioInfo!]!
      profiles: [ProfileInfo!]!
    }
    type Mutation {
      ${CORE_MUTATIONS}
      ${kind.mutationFields}
    }
  `
  const kindMutations: Record<string, unknown> = {}
  for (const [field, handler] of Object.entries(kind.mutations)) {
    kindMutations[field] = (_: unknown, args: Record<string, unknown>) => { handler(ctx, args); return worldState(ctx, kind) }
  }
  return createSchema({
    typeDefs,
    resolvers: {
      Query: {
        clock: () => ctx.clock.now(),
        groundTruth: () => kind.groundTruth(ctx),
        worldState: () => worldState(ctx, kind),
        scenarios: () => Object.values(kind.scenarios).map(s => ({ name: s.name, description: s.description })),
        profiles: () => Object.values(D11_PROFILES).map(p => ({ id: p.id, standard: p.standard })),
      },
      Mutation: {
        setEnvironment: (_: unknown, args: { conditions: Partial<Environment> }) => { ctx.instrument.setEnvironment(args.conditions); return worldState(ctx, kind) },
        playProfile: (_: unknown, args: { profile: string }) => {
          const program = D11_PROFILES[args.profile]
          if (!program) throw new Error(`unknown profile '${args.profile}' (known: ${Object.keys(D11_PROFILES).join(', ')})`)
          ctx.player?.stop()
          ctx.player = new ProfilePlayer(program)
          ctx.player.start(ctx.clock, e => ctx.instrument.setEnvironment(e))
          return worldState(ctx, kind)
        },
        advanceTime: (_: unknown, args: { seconds: number }) => { ctx.clock.advance(args.seconds); return worldState(ctx, kind) },
        setClockMode: (_: unknown, args: { mode: string }) => {
          if (args.mode !== 'manual' && args.mode !== 'wall') throw new Error(`clock mode must be manual|wall, got '${args.mode}'`)
          ctx.clock.setMode(args.mode); return worldState(ctx, kind)
        },
        scenario: (_: unknown, args: { name: string }) => {
          const s = kind.scenarios[args.name]
          if (!s) throw new Error(`unknown scenario '${args.name}' (known: ${Object.keys(kind.scenarios).join(', ')})`)
          ctx.swap(s.definition)
          return worldState(ctx, kind)
        },
        injectFault: () => { ctx.instrument.injectFault(); return worldState(ctx, kind) },
        clearFault: () => { ctx.instrument.clearFault(); return worldState(ctx, kind) },
        reset: () => { ctx.player?.stop(); ctx.instrument.reset(); return worldState(ctx, kind) },
        ...kindMutations,
      },
    },
  })
}

/** The load-cell kind (instrument family #1): force actuation plus the
 *  served-boundary and thermal-memory knobs. */
export const LOAD_CELL_WORLD_KIND: WorldKind<SimulatedInstrument, InstrumentDefinition> = {
  types: /* GraphQL */ `
    type GroundTruth {
      appliedLoadKg: Float!
      strainMm: Float!
      clockS: Float!
      spanDriftFraction: Float!
      thermalOffsetMVperV: Float!
      environment: Environment!
    }
  `,
  mutationFields: /* GraphQL */ `
    placeLoad(massKg: Float!): WorldState!
    removeLoad: WorldState!
    setFidelity(servedOffsetKg: Float, servedLagS: Float): WorldState!
    setThermalHysteresis(perDegC: Float!, tauS: Float): WorldState!
  `,
  scenarios: Object.fromEntries(Object.values(SCENARIOS).map(s => [s.name, { name: s.name, description: s.description, definition: s }])),
  groundTruth: ctx => ctx.instrument.groundTruth(),
  mutations: {
    placeLoad: (ctx, args) => { ctx.instrument.setLoad((args as { massKg: number }).massKg) },
    removeLoad: ctx => { ctx.instrument.removeLoad() },
    setFidelity: (ctx, args) => {
      const a = args as { servedOffsetKg?: number; servedLagS?: number }
      ctx.instrument.setFidelity({ servedOffsetKg: a.servedOffsetKg ?? 0, servedLagS: a.servedLagS ?? 0 })
    },
    setThermalHysteresis: (ctx, args) => {
      const a = args as { perDegC: number; tauS?: number }
      ctx.instrument.setThermalHysteresis(a.perDegC, a.tauS ?? ctx.instrument.thermalHysteresis.tauS)
    },
  },
}

/** The load-cell /world channel (the original signature — family #1's
 *  entry point). */
export function buildWorldSchema(ctx: WorldContext<SimulatedInstrument, InstrumentDefinition>): GraphQLSchema {
  return buildWorldSchemaFor(ctx, LOAD_CELL_WORLD_KIND)
}
