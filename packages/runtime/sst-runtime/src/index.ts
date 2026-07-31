// @primmel/sst-runtime — the Primmel SST runtime.
//
// Owns ALL framework code: the physics engine, the dual-schema server,
// the twin-schema generator, the console, the package loader, the
// per-kind boot-strategy registry, the typed TwinDriver/WorldDriver,
// and the scene context. This is the single import for every consumer
// (bins, tests, the bench, external clients).

// ── SST runtime surface ──────────────────────────────────────────────
export * from './package-loader.js'
export * from './kinds/registry.js'
export * from './stages/registry.js'
export * from './session.js'
export * from './twin/driver.js'
export * from './twin/driver-types.js'
export * from './twin/transport.js'
export * from './twin/freshness.js'
export type { FreshnessVerdict } from './twin/freshness-check.js'
export { enforceFreshnessOrThrow } from './twin/freshness-check.js'
export * from './twin/types.js'
export * from './twin/introspect.js'
export * from './world/driver.js'
export * from './world/types.js'
export * from './scene/context.js'
export * from './scene/gltf.js'
export { loadBehavior, hasBehavior, type LoadedBehavior } from './kinds/behavior-loader.js'
export { buildTwinIo } from './kinds/twin-io-builder.js'
export { tryBootFromBehavior } from './kinds/boot-from-behavior.js'
export { assembleWorldKind, buildWorldSchemaFromKind } from './kinds/world-schema-assembler.js'

// ── Framework: time + quantities + RNG ───────────────────────────────
export { VirtualClock, type ClockMode } from './time.js'
export { qty, add, subtract, mul, abs, UNITS, type Qty, type Unit, type QuantityKind } from './physics/quantity.js'
export { mulberry32, normal } from './physics/rng.js'

// ── Framework: physics stages ────────────────────────────────────────
export { MechanicalStage } from './physics/stages/mechanical.js'
export { CONSTRUCTION_PROFILES, COMPRESSION, type ConstructionProfile } from './physics/families/construction.js'
export { TransductionStage, type TransductionParams } from './physics/stages/transduction.js'
export { ConditioningStage, type ConditioningParams, type TechnologyStack } from './physics/stages/conditioning.js'
export { pointerPositionKg, readingUncertaintyKg, type DialSpec } from './physics/stages/dial.js'
export {
  GasTransductionStage, gasDensity, GAS_REFERENCE,
  type GasSample, type GasTransductionParams, type NdirTransductionParams, type CldTransductionParams,
} from './physics/stages/gas-transduction.js'
export { GasConditioningStage, type GasConditioningParams, type ConditioningContext } from './physics/stages/gas-conditioning.js'

// ── Framework: instruments ───────────────────────────────────────────
export {
  SimulatedInstrument, LC500_GOOD, LC500_PAIRED_DIAL, REFERENCE_ENVIRONMENT,
  type Environment, type GroundTruth, type InstrumentDefinition, type InstrumentParameters,
  type OperationalState, type FidelityKnobs, HONEST_FIDELITY,
} from './instrument.js'
export {
  SimulatedGasAnalyzer, GAS_ANALYZER_GOOD, GAS_COMPONENTS, AMBIENT_AIR,
  type GasComponent, type GasChannelDefinition, type GasAnalyzerDefinition, type GasAnalyzerParameters,
  type GasBench, type ChannelTruth, type GasGroundTruth, type InitialFaults,
} from './gas-instrument.js'

// ── Framework: environment (D 11) ────────────────────────────────────
export { D11_CONDITIONS, D11_EVENT_STANDARDS, type ConditionClass, type SeverityLevel, type EnvironmentEvent } from './environment/conditions.js'
export { D11_PROFILES, ProfilePlayer, interpolate, slew, type ProfileProgram, type ProfileKeyframe } from './environment/profiles.js'

// ── Framework: scenarios ─────────────────────────────────────────────
export { SCENARIOS, getScenario, validateScenario, type Scenario } from './scenario.js'
export { GAS_SCENARIOS, getGasScenario, validateGasScenario, type GasScenario } from './gas-scenario.js'

// ── Framework: world schemas ─────────────────────────────────────────
export { buildWorldSchema, buildWorldSchemaFor, LOAD_CELL_WORLD_KIND, type WorldContext, type WorldInstrument, type WorldKind } from './world-schema.js'
export { buildGasWorldSchema, GAS_WORLD_KIND, type GasWorldContext } from './gas-world.js'

// ── Framework: server + twin schema + conformance ────────────────────
export { createSimServer, type SimServer, type SimServerOptions } from './server.js'
export { generateTwinSchema, snakeToCamel, type TwinIo, type TwinInstrumentView } from './twin-schema.js'
export { checkTwinConformance } from './conformance.js'

// ── Framework: twin contracts + models + bake ────────────────────────
export {
  LC500_CONTRACT, LC500_FULL_MODEL,
  GAS_ANALYZER_CONTRACT, GAS_ANALYZER_FULL_MODEL,
  RS180_CONTRACT, RS180_FULL_MODEL,
  MD3XX_CONTRACT, MD3XX_FULL_MODEL,
  type TwinContract, type TwinOperation, type ServeDeclaration,
  type InstrumentModel, type InstrumentIdentification, type Classification,
  type DesignParameters, type ModelQuantity, type MpeBand, type MetrologicalLimits, type Provenance,
  withModel,
} from './twin-contract.js'
export { bakeTwinContract, loadBakedContract, type BakedContract } from './twin-bake.js'

// ── Framework: console ───────────────────────────────────────────────
export { parseCommand, PRIVILEGED_KINDS, HELP_TEXT, type ConsoleAction } from './console/grammar.js'
export { execute, httpConsoleIo, promptOf, type ConsoleIo, type ConsoleState } from './console/client.js'
export { runConsole } from './console/readline.js'
export { LC500_TOUR } from './console/tour.js'
