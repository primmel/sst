// instrument.ts — the composition root (spec §4.1/§4.4): stages +
// clock + environment state. The epistemic wall (law 1) is here:
// indication()/servedAt()/operationalState() are the instrument's
// legal view; groundTruth() is reality, exposed to /world only.
import type { VirtualClock } from './time.js'
import { qty, type Qty } from './physics/quantity.js'
import { mulberry32, normal } from './physics/rng.js'
import { MechanicalStage } from './physics/stages/mechanical.js'
import { CONSTRUCTION_PROFILES, type ConstructionProfile } from './physics/families/construction.js'
import { TransductionStage, type TransductionParams } from './physics/stages/transduction.js'
import { ConditioningStage, type ConditioningParams, type TechnologyStack } from './physics/stages/conditioning.js'
import type { DialSpec } from './physics/stages/dial.js'

export interface Environment { temperatureDegC: number; humidityPercentRh: number; pressureKPa: number }

export const REFERENCE_ENVIRONMENT: Environment = { temperatureDegC: 20, humidityPercentRh: 50, pressureKPa: 101.325 }

export interface InstrumentParameters extends Omit<ConditioningParams, 'stack'>, TransductionParams {
  warmUpTauS: number
  spanDriftPerDay: number
}

export interface InstrumentDefinition {
  id: string
  /** a CONSTRUCTION_PROFILES id, or an inline profile (scenarios carry
   *  tweaked profiles as data — spec §8). */
  construction: string | ConstructionProfile
  stack: TechnologyStack
  parameters: InstrumentParameters
  /** twin-fidelity knobs (spec §8.1) — absent = the honest twin. */
  fidelity?: FidelityKnobs
}

export interface GroundTruth {
  appliedLoadKg: number
  strainMm: number
  clockS: number
  environment: Environment
  spanDriftFraction: number
  /** the thermal-hysteresis residual at the bridge (mV/V) — reality,
   *  /world only. */
  thermalOffsetMVperV: number
}

export type OperationalState = 'off' | 'warming' | 'ready' | 'fault'

/** Twin-fidelity knobs (spec §8.1): dishonesty injected at the SERVED
 *  boundary only — groundTruth() never sees them (the epistemic wall).
 *  Default is the honest twin. */
export interface FidelityKnobs {
  servedOffsetKg: number
  servedLagS: number
}

export const HONEST_FIDELITY: FidelityKnobs = { servedOffsetKg: 0, servedLagS: 0 }

export class SimulatedInstrument {
  #def: InstrumentDefinition
  #profile: ConstructionProfile
  #clock: VirtualClock
  #mech: MechanicalStage
  #trans: TransductionStage
  #cond: ConditioningStage
  #env: Environment = { ...REFERENCE_ENVIRONMENT }
  #poweredAt = 0
  #state: OperationalState = 'warming'
  #spanDriftFraction = 0
  #lastDt = 0.001
  #faults: string[] = []
  #faultLatched = false
  #lastIndication: Qty | undefined
  #fidelity: FidelityKnobs = { ...HONEST_FIDELITY }

  constructor(def: InstrumentDefinition, clock: VirtualClock, seed: number) {
    const profile = typeof def.construction === 'string'
      ? CONSTRUCTION_PROFILES[def.construction]
      : def.construction
    if (!profile) throw new Error(`unknown construction profile '${def.construction}' (known: ${Object.keys(CONSTRUCTION_PROFILES).join(', ')})`)
    this.#def = def
    this.#profile = profile
    this.#clock = clock
    this.#mech = new MechanicalStage(profile, mulberry32(seed))
    this.#trans = new TransductionStage({ ...def.parameters }) // own copy — setThermalHysteresis must never mutate the shared definition record
    this.#cond = new ConditioningStage({ ...def.parameters, stack: def.stack }, normal(mulberry32(seed)))
    this.#poweredAt = clock.now()
    if (def.fidelity) this.#fidelity = { ...def.fidelity }
    clock.onAdvance(dt => this.#tick(dt))
  }

  #tick(dt: number): void {
    this.#lastDt = dt
    this.#mech.advance(dt)
    this.#trans.advance(dt, this.#env)
    this.#spanDriftFraction += this.#def.parameters.spanDriftPerDay * (dt / 86400)
    if (this.#state === 'warming' && this.#clock.now() - this.#poweredAt >= 5 * this.#def.parameters.warmUpTauS) this.#state = 'ready'
  }

  /** Strain as a fraction of rated full-scale (the calibration:
   *  capacity × compliance = strain at capacity; sensitivity is the
   *  rated mV/V at that strain, so kgPerMVperV = capacity/sensitivity). */
  get #strainFraction(): number {
    const atCapacity = this.#def.parameters.capacityKg * this.#profile.complianceKgPerMm
    return this.#mech.strainMm / atCapacity
  }
  get #kgPerMVperV(): number { return this.#def.parameters.capacityKg / this.#def.parameters.sensitivityMVperV }

  setLoad(massKg: number): void { this.#mech.setLoad(massKg) }
  removeLoad(): void { this.#mech.setLoad(0) }
  setEnvironment(e: Partial<Environment>): void { this.#env = { ...this.#env, ...e } }

  indication(): Qty {
    // Inoperative while faulted (R 60-1, 5.7.1.2): the served
    // indication freezes at the last computed value.
    if (this.#faultLatched && this.#lastIndication !== undefined) return this.#lastIndication
    const bridge = this.#trans.output(this.#strainFraction, this.#env) * (1 + this.#spanDriftFraction)
    const warm = this.#warmFactor
    const out = this.#cond.process(bridge * warm, this.#lastDt, this.#env, this.#kgPerMVperV)
    this.#faults = out.faults
    if (out.faults.length > 0 && this.#state === 'ready') this.#state = 'fault'
    const value = qty(out.indicationKg + this.#fidelity.servedOffsetKg, 'kg')
    if (!this.#faultLatched) this.#lastIndication = value
    return value
  }

  /** First-order warm-up envelope on the electronics (spec §4.4). */
  get #warmFactor(): number {
    const tau = this.#def.parameters.warmUpTauS
    const t = this.#clock.now() - this.#poweredAt
    return tau <= 0 ? 1 : 1 - Math.exp(-t / tau) * 0.001 // residual settles to 0.1 % then 0
  }

  servedAt(): number { return this.#clock.now() - this.#fidelity.servedLagS }
  /** The sensed environmental context (the instrument's legal view —
   *  what a real instrument's own T/RH/P sensors would report). */
  environment(): Environment { return { ...this.#env } }
  operationalState(): OperationalState {
    // A latched fault dominates: R 60-1, 5.7.1.2 — the cell is made
    // inoperative (or a fault detection output issued) until the fault
    // is resolved.
    if (this.#faultLatched) return 'fault'
    return this.#state
  }

  /** /world-only fault injection (gap B2): drive the operational state
   *  machine to `fault` — the self_test behavior's legal outcome
   *  (R 60-1, 5.7.1.2), not a physics cheat. The served indication
   *  freezes (the cell is inoperative) until clearFault/reset.
   *  Never reachable from /twin. */
  injectFault(): void { this.#faultLatched = true }

  /** Resolve a latched fault (the instrument returns to its machine
   *  state at injection time — R 60-1, 5.7.1.2's "until the fault is
   *  resolved"). */
  clearFault(): void { this.#faultLatched = false }

  /** The current fault latch (ground truth — /world only). */
  get faultLatched(): boolean { return this.#faultLatched }

  /** /world-only operation: the physics knobs (spec — the post-cycle
   *  difference is operator-configurable). Never reachable from /twin. */
  setFidelity(knobs: FidelityKnobs): void { this.#fidelity = { ...knobs } }

  /** /world-only: retune the thermal-hysteresis memory live. */
  setThermalHysteresis(perDegC: number, tauS: number): void {
    this.#trans.setThermalHysteresis(perDegC, tauS)
  }

  /** The current thermal-hysteresis tuning (for /world queries). */
  get thermalHysteresis(): { perDegC: number; tauS: number } {
    return this.#trans.thermalHysteresis
  }

  groundTruth(): GroundTruth {
    return {
      appliedLoadKg: this.#mech.appliedLoadKg,
      strainMm: this.#mech.strainMm,
      clockS: this.#clock.now(),
      environment: { ...this.#env },
      spanDriftFraction: this.#spanDriftFraction,
      thermalOffsetMVperV: this.#trans.thermalOffsetMVperV,
    }
  }

  reset(): void {
    this.#mech.reset()
    this.#spanDriftFraction = 0
    this.#poweredAt = this.#clock.now()
    this.#state = 'warming'
    this.#env = { ...REFERENCE_ENVIRONMENT }
    this.#faults = []
    this.#faultLatched = false
    this.#lastIndication = undefined
  }
}

/** The LC-500-class good-cell definition (spec §4.4: digital stack ×
 *  compression profile, class C6, E_max 500 kg, n_lc 6000 — all
 *  coefficients inside R 60 limits). */
export const LC500_GOOD: InstrumentDefinition = {
  id: 'lc500-good',
  construction: 'compression',
  stack: 'digital',
  parameters: {
    capacityKg: 500, scaleIntervalKg: 0.05,
    sensitivityMVperV: 2.0, gaugeFactor: 2.0, excitationV: 10,
    tcZeroPerDegC: 0.0001, tcSpanPerDegC: 0.0002, barometricPerKPa: 0.00005,
    referenceTempDegC: 20, referencePressureKPa: 101.325,
    thermalHysteresisPerDegC: 0.00002, thermalHysteresisTauS: 3600,
    filterTauS: 1.0, linearizationErrorKg: 0.01, compensationResidualPerDegC: 0.0005,
    noiseSigmaKg: 0.005, warmUpTauS: 60, spanDriftPerDay: 0.000005,
  },
}

/** The paired analogue-passive indicator (spec §14, smart TODO.v2/09):
 *  a 500 kg dial at 5 kg graduations (100 divisions; a human
 *  interpolates to ±½ graduation = ±2.5 kg) alongside the digital
 *  stack. Declared once here — the dial model and the bench renderer
 *  both consume it; the smart practice flows name the same pairing as
 *  app-side content (the repos meet over HTTP only, never by import). */
export const LC500_PAIRED_DIAL: DialSpec = { capacityKg: 500, graduationKg: 5, unit: 'kg' }
