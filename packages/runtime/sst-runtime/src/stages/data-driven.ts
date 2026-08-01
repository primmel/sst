// stages/data-driven.ts — the data-driven physics-chain composer.
//
// Reads the kind's physics-chain.yaml at runtime, selects one stage per
// position by matching the instance's classification (construction /
// technology / stack), looks up each stage in STAGE_REGISTRY, and pipes
// data through the chain by port key.
//
// This is the "fully model-driven physics" promise, made real: the kind
// declares the chain as data; the runtime composes; the instance supplies
// coefficients. Adding a new physics phenomenon = adding a stage file +
// one registry entry + one chain entry — no edits to existing stages or
// to the composer.
//
// Stage interface
// ───────────────
// Each registered Stage conforms to:
//
//   interface Stage {
//     process(inputs: PortMap, ctx: TickContext): PortMap
//   }
//
// Where PortMap = Record<string, number>. The mechanical stage consumes
// { applied_load_kg } and produces { strain_mm }; transduction consumes
// { strain_mm } and produces { bridge_mV_per_V }; conditioning consumes
// { bridge_mV_per_V } and produces { indication_kg }. The composer pipes
// each stage's outputs into the next stage's inputs by port key.

import type { TickContext, Stage, PortMap, StageFactory, Environment } from './stage-interface.js'
import { registerStage, lookupStage, listStages } from './registry.js'
import { MechanicalStage } from '../physics/stages/mechanical.js'
import { TransductionStage } from '../physics/stages/transduction.js'
import { ConditioningStage } from '../physics/stages/conditioning.js'
import { CONSTRUCTION_PROFILES } from '../physics/families/construction.js'
import { mulberry32, normal as normalRng } from '../physics/rng.js'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parse as parseYaml } from 'yaml'

// ── physics-chain.yaml declaration shape ──────────────────────────────

export interface PhysicsChainStageDecl {
  key: string
  position: number
  description?: string
  consumes?: Record<string, string>
  produces?: Record<string, string>
  applies_to_constructions?: string[]
  applies_to_technologies?: string[]
  applies_to_stacks?: string[]
}

export interface PhysicsChainDecl {
  stages: PhysicsChainStageDecl[]
}

export interface InstanceClassification {
  construction?: string
  technology?: string
  stack?: string
  [k: string]: string | undefined
}

// ── DataDrivenComposer ────────────────────────────────────────────────

interface ResolvedStage {
  decl: PhysicsChainStageDecl
  stage: Stage
}

export class DataDrivenComposer {
  readonly #chain: ResolvedStage[]
  readonly #consumesFirst: string[]

  constructor(
    decl: PhysicsChainDecl,
    classification: InstanceClassification,
    coefficients: Record<string, number>,
    seed: number,
  ) {
    this.#chain = resolveChain(decl, classification, coefficients, seed)
    if (this.#chain.length === 0) {
      throw new Error('data-driven composer: no stages resolved from physics-chain.yaml')
    }
    this.#consumesFirst = Object.keys(this.#chain[0]!.decl.consumes ?? {})
    if (this.#consumesFirst.length === 0) {
      throw new Error(`data-driven composer: first stage '${this.#chain[0]!.decl.key}' declares no consumes`)
    }
  }

  tick(inputs: PortMap, ctx: TickContext): PortMap {
    if (!(this.#consumesFirst[0]! in inputs)) {
      throw new Error(
        `data-driven composer: missing first-stage input '${this.#consumesFirst[0]}' (got: ${Object.keys(inputs).join(', ')})`,
      )
    }
    let ports: PortMap = { ...inputs }
    for (const { stage } of this.#chain) {
      ports = stage.process(ports, ctx)
    }
    return ports
  }

  chainKeys(): string[] {
    return this.#chain.map((s) => s.decl.key)
  }
}

// ── Chain resolution ──────────────────────────────────────────────────

function resolveChain(
  decl: PhysicsChainDecl,
  classification: InstanceClassification,
  coefficients: Record<string, number>,
  seed: number,
): ResolvedStage[] {
  const byPosition = new Map<number, PhysicsChainStageDecl[]>()
  for (const s of decl.stages) {
    const bucket = byPosition.get(s.position) ?? []
    bucket.push(s)
    byPosition.set(s.position, bucket)
  }
  const positions = [...byPosition.keys()].sort((a, b) => a - b)

  const resolved: ResolvedStage[] = []
  let rngSeed = seed
  for (const pos of positions) {
    const candidates = byPosition.get(pos)!
    const picked = pickStageForClassification(candidates, classification)
    if (!picked) {
      throw new Error(
        `data-driven composer: no stage at position ${pos} matches classification ` +
        `${JSON.stringify(classification)} (candidates: ${candidates.map((c) => c.key).join(', ')})`,
      )
    }
    const factory = lookupStage(picked.key)
    const stage = factory.create({ coefficients, seed: rngSeed })
    rngSeed = rngSeed + 1
    resolved.push({ decl: picked, stage })
  }
  return resolved
}

function pickStageForClassification(
  candidates: PhysicsChainStageDecl[],
  c: InstanceClassification,
): PhysicsChainStageDecl | null {
  for (const s of candidates) {
    if (s.applies_to_constructions && !s.applies_to_constructions.includes(c.construction ?? '')) continue
    if (s.applies_to_technologies && !s.applies_to_technologies.includes(c.technology ?? '')) continue
    if (s.applies_to_stacks && !s.applies_to_stacks.includes(c.stack ?? '')) continue
    return s
  }
  return null
}

// ── Built-in R 60 stage registrations ─────────────────────────────────
// Each registered factory wraps a core stage behind the Stage port-key
// interface. The chain in physics-chain.yaml references these keys.
//
// R 144 / R 91 / R 129 stages are not registered here — those families
// use their legacy direct-stage paths (their physics is more complex
// than the simple `applied_load_kg → strain_mm → bridge_mV_per_V →
// indication_kg` port pattern). They can be migrated to the data-driven
// path one kind at a time when their instance packages ship a
// physics-chain.yaml that matches their semantics.

interface StageCreateParams {
  coefficients: Record<string, number>
  seed: number
}

const coeff = (c: Record<string, number>, key: string, fallback: number): number => {
  const v = c[key]
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

// r60/mechanical-* — wraps MechanicalStage. Profile chosen by suffix.
// The construction profile is looked up by key; unknown profiles fall
// back to 'compression' (the only registered profile in v1).
//
// PORT CONTRACT: the `strain_mm` port carries strain AS A FRACTION OF
// RATED FULL-SCALE, not in millimetres — the downstream transduction
// stage's output(strainMm, …) multiplies span × strainMm where strainMm
// is the fraction (legacy SimulatedInstrument.#strainFraction at
// instrument.ts:103). Without this normalization, a 40 kg load on a
// 500 kg cell produces strainMm=8e-5 mm; the transduction produces
// 0.00016 mV/V; conditioning rounds to one scale interval (0.05 kg)
// and the indication sits at the floor — the data-driven lc500 boot
// bug the smart side's `prefer: 'legacy-bin'` worked around.
function makeR60Mechanical(profileKey: string): StageFactory {
  return {
    stageKey: '',
    create({ coefficients: c, seed }: StageCreateParams): Stage {
      const profile = CONSTRUCTION_PROFILES[profileKey] ?? CONSTRUCTION_PROFILES['compression']!
      const stage = new MechanicalStage(profile, mulberry32(seed))
      const atCapacity = (c['capacity_kg'] ?? 500) * profile.complianceKgPerMm
      return {
        process(inputs: PortMap, ctx: TickContext): PortMap {
          stage.setLoad(inputs['applied_load_kg'] ?? 0)
          stage.advance(ctx.dtS)
          return { strain_mm: atCapacity > 0 ? stage.strainMm / atCapacity : 0 }
        },
      }
    },
  }
}

function makeR60Transduction(): StageFactory {
  return {
    stageKey: '',
    create({ coefficients: c, seed }: StageCreateParams): Stage {
      void seed
      const stage = new TransductionStage({
        sensitivityMVperV: coeff(c, 'sensitivity_mVperV', 2.0),
        gaugeFactor: coeff(c, 'gauge_factor', 2.0),
        excitationV: coeff(c, 'excitation_V', 10),
        tcZeroPerDegC: coeff(c, 'tc_zero_per_degC', 0.0001),
        tcSpanPerDegC: coeff(c, 'tc_span_per_degC', 0.0002),
        barometricPerKPa: coeff(c, 'barometric_per_kPa', 0.00005),
        referenceTempDegC: coeff(c, 'reference_temp_degC', 20),
        referencePressureKPa: coeff(c, 'reference_pressure_kPa', 101.325),
        thermalHysteresisPerDegC: coeff(c, 'thermal_hysteresis_per_degC', 0.00002),
        thermalHysteresisTauS: coeff(c, 'thermal_hysteresis_tau_s', 3600),
      })
      return {
        process(inputs: PortMap, ctx: TickContext): PortMap {
          stage.advance(ctx.dtS, ctx.env)
          const bridge = stage.output(inputs['strain_mm'] ?? 0, ctx.env)
          return { bridge_mV_per_V: bridge }
        },
      }
    },
  }
}

function makeR60Conditioning(stack: 'digital' | 'digital-processing' | 'analog-active' | 'analog-passive'): StageFactory {
  return {
    stageKey: '',
    create({ coefficients: c, seed }: StageCreateParams): Stage {
      const stage = new ConditioningStage({
        stack,
        scaleIntervalKg: coeff(c, 'scale_interval_kg', 0.05),
        capacityKg: coeff(c, 'capacity_kg', 500),
        filterTauS: coeff(c, 'filter_tau_s', 1.0),
        linearizationErrorKg: coeff(c, 'linearization_error_kg', 0.01),
        compensationResidualPerDegC: coeff(c, 'compensation_residual_per_degC', 0.0005),
        noiseSigmaKg: coeff(c, 'noise_sigma_kg', 0.005),
      }, normalRng(mulberry32(seed + 1)))
      const kgPerMVperV = coeff(c, 'capacity_kg', 500) / Math.max(coeff(c, 'sensitivity_mVperV', 2.0), 0.001)
      return {
        process(inputs: PortMap, ctx: TickContext): PortMap {
          const out = stage.process(inputs['bridge_mV_per_V'] ?? 0, ctx.dtS, ctx.env, kgPerMVperV)
          return { indication_kg: out.indicationKg }
        },
      }
    },
  }
}

// ── Registration ──────────────────────────────────────────────────────

let R60_STAGES_REGISTERED = false

/** Register the R 60 (load-cell) stage factories. Idempotent. */
export function registerR60Stages(): void {
  if (R60_STAGES_REGISTERED) return
  const entries: Array<[string, StageFactory]> = [
    ['r60/mechanical-compression', makeR60Mechanical('compression')],
    ['r60/mechanical-shear-beam', makeR60Mechanical('shear-beam')],
    ['r60/mechanical-bending-beam', makeR60Mechanical('bending-beam')],
    ['r60/transduction-strain-gauge', makeR60Transduction()],
    ['r60/conditioning-digital', makeR60Conditioning('digital')],
    ['r60/conditioning-digital-processing', makeR60Conditioning('digital-processing')],
    ['r60/conditioning-analog-active', makeR60Conditioning('analog-active')],
    ['r60/conditioning-analog-passive', makeR60Conditioning('analog-passive')],
  ]
  for (const [key, factory] of entries) {
    registerStage({ ...factory, stageKey: key })
  }
  R60_STAGES_REGISTERED = true
}

// Eagerly register on import so the registry is populated as soon as
// the runtime loads. This is the only place that wires "stage keys
// referenced by physics-chain.yaml" to "stage implementations."
registerR60Stages()

// ── Chain declaration loader ──────────────────────────────────────────

/** Load a physics-chain.yaml from disk and return the parsed declaration. */
export function loadPhysicsChain(filePath: string): PhysicsChainDecl {
  const text = readFileSync(resolve(filePath), 'utf-8')
  const parsed = parseYaml(text) as PhysicsChainDecl
  if (!parsed || !Array.isArray(parsed.stages) || parsed.stages.length === 0) {
    throw new Error(`physics-chain.yaml at ${filePath} has no stages`)
  }
  return parsed
}

export { lookupStage, listStages, registerStage }
export type { Stage, PortMap, StageFactory, TickContext, Environment }
