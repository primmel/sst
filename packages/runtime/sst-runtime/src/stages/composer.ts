// stages/composer.ts — the stage composition engine.
//
// Reads the kind's physics-chain.yaml, instantiates the named stages
// from STAGE_REGISTRY, feeds the instance's coefficients into them,
// and pipes them into a composed signal chain:
//
//   applied load (kg)
//     → [1] MECHANICAL      strain, hysteresis, creep, resonance
//     → [2] TRANSDUCTION    bridge output (mV/V)
//     → [3] CONDITIONING    filter, ADC, linearization, compensation
//     → indication (kg)
//
// This is the "fully model-driven physics" promise: the kind declares
// the chain, the instance provides coefficients, the runtime composes.

import { VirtualClock } from '../time.js'
import { MechanicalStage } from '../physics/stages/mechanical.js'
import { TransductionStage } from '../physics/stages/transduction.js'
import { ConditioningStage } from '../physics/stages/conditioning.js'
import { CONSTRUCTION_PROFILES } from '../physics/families/construction.js'
import { mulberry32, normal as normalRng } from '../physics/rng.js'
import type { Qty } from '../physics/quantity.js'
import type { Environment } from '../instrument.js'
import { DataDrivenComposer, type PhysicsChainDecl } from './data-driven.js'

// ── The composed instrument ───────────────────────────────────────────

export interface PhysicsChainStage {
  key: string
  position: number
}

export interface ComposedInstrumentConfig {
  classification: {
    construction: string        // 'compression' | 'shear-beam' | ...
    technology: string          // 'strain-gauge' | ...
    stack: string               // 'digital' | 'analog-active' | ...
  }
  coefficients: Record<string, number>
  fidelity?: { servedOffsetKg?: number; servedLagS?: number }
  /** Optional physics-chain declaration (the kind's physics-chain.yaml).
   *  When provided, the composer uses the data-driven path: it selects
   *  stages by classification and resolves them from STAGE_REGISTRY.
   *  When omitted, the legacy direct-stage path is used (the three
   *  stages wired by hand below). */
  physicsChain?: PhysicsChainDecl
}

  /** A ComposedInstrument wraps the R 60 stage chain and exposes the
   *  TwinInstrumentView + WorldInstrument interface. The runtime creates
   *  one per session from the kind's physics-chain + the instance's
   *  coefficients. */
  export class ComposedInstrument {
    #mech: MechanicalStage
    #trans: TransductionStage
    #cond: ConditioningStage
    #clock: VirtualClock
    #appliedLoadKg = 0
    #env: Environment = { temperatureDegC: 20, humidityPercentRh: 50, pressureKPa: 101.325 }
    #fidelity: { servedOffsetKg: number; servedLagS: number }
  #faulted = false
  #fixedKgPerMVperV = 25
  #atCapacity = 1                   // capacity (kg) × compliance (mm/kg); used to normalize strainMm → fraction
  #zeroOffsetKg = 0          // adjusted by zeroSetting()
  #selfTestResult: 'pass' | 'fail' | null = null
    #lastIndication: Qty = { value: 0, unit: 'kg', kind: 'mass' }
    #servedAt = 0
    #dataDriven: DataDrivenComposer | null = null

    constructor(
      config: ComposedInstrumentConfig,
      clock: VirtualClock,
      seed: number,
    ) {
      this.#clock = clock
      this.#fidelity = {
        servedOffsetKg: config.fidelity?.servedOffsetKg ?? 0,
        servedLagS: config.fidelity?.servedLagS ?? 0,
      }
      // Self-subscribe to clock advances — the signal chain ticks on
      // every advance, just like SimulatedInstrument (instrument.ts:87)
      // and SimulatedGasAnalyzer (gas-instrument.ts:132). Without this,
      // indication() returns the initial { value: 0 } forever; the
      // stages never run.
      clock.onAdvance(dt => this.tick(dt))

      if (config.physicsChain) {
        // Data-driven path: resolve stages from STAGE_REGISTRY, pipe
        // data through the chain. The three legacy stages below stay
        // uninitialised (sentinel values); only #dataDriven is used.
        this.#dataDriven = new DataDrivenComposer(
          config.physicsChain,
          config.classification,
          config.coefficients,
          seed,
        )
        // Sentinel legacy stages — never used in data-driven mode but
        // required by the field declarations. Constructed with neutral
        // parameters so they don't allocate meaningful state.
        const profile = CONSTRUCTION_PROFILES['compression']!
        this.#mech = new MechanicalStage(profile, mulberry32(seed))
        this.#trans = new TransductionStage({
          sensitivityMVperV: 2.0, gaugeFactor: 2.0, excitationV: 10,
          tcZeroPerDegC: 0, tcSpanPerDegC: 0, barometricPerKPa: 0,
          referenceTempDegC: 20, referencePressureKPa: 101.325,
          thermalHysteresisPerDegC: 0, thermalHysteresisTauS: 3600,
        })
        this.#cond = new ConditioningStage({
          stack: 'digital', scaleIntervalKg: 0.05, capacityKg: 500,
          filterTauS: 1.0, linearizationErrorKg: 0,
          compensationResidualPerDegC: 0, noiseSigmaKg: 0,
        }, normalRng(mulberry32(seed + 1)))
        return
      }

      // Legacy direct-stage path (no physics-chain.yaml provided).
      const profile = CONSTRUCTION_PROFILES[config.classification.construction] ?? CONSTRUCTION_PROFILES['compression']!
      const c = config.coefficients
      const capacityKg = c.capacity_kg ?? 500
      this.#atCapacity = capacityKg * profile.complianceKgPerMm
      this.#mech = new MechanicalStage(profile, mulberry32(seed))
      this.#trans = new TransductionStage({
        sensitivityMVperV: c.sensitivity_mVperV ?? 2.0,
        gaugeFactor: c.gauge_factor ?? 2.0,
        excitationV: c.excitation_V ?? 10,
        tcZeroPerDegC: c.tc_zero_per_degC ?? 0.0001,
        tcSpanPerDegC: c.tc_span_per_degC ?? 0.0002,
        barometricPerKPa: c.barometric_per_kPa ?? 0.00005,
        referenceTempDegC: c.reference_temp_degC ?? 20,
        referencePressureKPa: c.reference_pressure_kPa ?? 101.325,
        thermalHysteresisPerDegC: c.thermal_hysteresis_per_degC ?? 0.00002,
        thermalHysteresisTauS: c.thermal_hysteresis_tau_s ?? 3600,
      })
      this.#cond = new ConditioningStage({
        stack: config.classification.stack as 'analog-passive' | 'analog-active' | 'digital' | 'digital-processing',
        scaleIntervalKg: c.scale_interval_kg ?? 0.05,
        capacityKg: c.capacity_kg ?? 500,
        filterTauS: c.filter_tau_s ?? 1.0,
        linearizationErrorKg: c.linearization_error_kg ?? 0.01,
        compensationResidualPerDegC: c.compensation_residual_per_degC ?? 0.0005,
        noiseSigmaKg: c.noise_sigma_kg ?? 0.005,
      }, normalRng(mulberry32(seed + 1)))

      // Fixed calibration constant: kgPerMVperV = capacity / rated_output_mVperV
      // The conditioning stage multiplies: indicationKg = bridge_mVperV × kgPerMVperV
      // So for a 500 kg cell with 2.0 mV/V rated output: 500 / 2.0 = 250
      this.#fixedKgPerMVperV = (c.capacity_kg ?? 500) / Math.max(c.sensitivity_mVperV ?? 2.0, 0.001)
    }

  // ── WorldInstrument interface ────────────────────────────────────────

  placeMass(massKg: number): void { this.#appliedLoadKg = massKg }
  removeMass(): void { this.#appliedLoadKg = 0 }
  setEnvironment(e: Partial<Environment>): void { this.#env = { ...this.#env, ...e } }
  setFidelity(knobs: { servedOffsetKg?: number; servedLagS?: number }): void {
    if (knobs.servedOffsetKg != null) this.#fidelity.servedOffsetKg = knobs.servedOffsetKg
    if (knobs.servedLagS != null) this.#fidelity.servedLagS = knobs.servedLagS
  }
  resetFidelity(): void { this.#fidelity = { servedOffsetKg: 0, servedLagS: 0 } }
  injectFault(): void { this.#faulted = true }
  clearFault(): void { this.#faulted = false }

  // ── Instrument-legal operations (TODO 26) ────────────────────────────

  /** Zero-setting: capture the current indication as the zero reference.
   *  Subsequent indications are relative to this zero. This is the
   *  R 60-1 §4.7 zero-setting operation — instrument-legal, exposed
   *  via the /twin command `zeroSetting`. */
  zeroSetting(): void {
    this.#zeroOffsetKg = this.#lastIndication.value - this.#fidelity.servedOffsetKg
  }

  /** Self-test: run a diagnostic sequence. In v1 this checks that the
   *  conditioning stage's filter is primed and the indication is finite.
   *  Returns 'pass' if OK; 'fail' if the instrument detected an internal
   *  fault. The result surfaces via the operational state. */
  runSelfTest(): 'pass' | 'fail' {
    const ind = this.#lastIndication.value
    const ok = Number.isFinite(ind) && !this.#faulted
    this.#selfTestResult = ok ? 'pass' : 'fail'
    return this.#selfTestResult
  }
  reset(): void {
    this.#appliedLoadKg = 0
    this.#env = { temperatureDegC: 20, humidityPercentRh: 50, pressureKPa: 101.325 }
    this.#lastIndication = { value: 0, unit: 'kg', kind: 'mass' }
    this.#servedAt = 0
  }

  // ── Signal chain (called on each tick) ───────────────────────────────

  tick(dtS: number): void {
    let rawIndicationKg: number
    if (this.#dataDriven) {
      // Data-driven path: pipe through the chain declared in physics-chain.yaml
      const out = this.#dataDriven.tick(
        { applied_load_kg: this.#appliedLoadKg },
        { dtS, env: this.#env, nowS: this.#clock.now() },
      )
      rawIndicationKg = out['indication_kg'] ?? 0
    } else {
      // Legacy direct-stage path.
      this.#mech.setLoad(this.#appliedLoadKg)
      this.#mech.advance(dtS)
      // Normalize strain to fraction-of-rated-full-scale before feeding
      // the transduction stage — matches SimulatedInstrument.#strainFraction
      // (instrument.ts:103). The legacy direct-stage path used raw mm
      // here, producing near-zero bridge output and indication stuck at
      // one scale interval.
      const strainFraction = this.#atCapacity > 0 ? this.#mech.strainMm / this.#atCapacity : 0
      this.#trans.advance(dtS, this.#env)
      const bridgeMVperV = this.#trans.output(strainFraction, this.#env)
      const condOut = this.#cond.process(bridgeMVperV, dtS, this.#env, this.#fixedKgPerMVperV)
      rawIndicationKg = condOut.indicationKg
    }

    // Apply twin-fidelity knobs + zero offset (the epistemic wall's dishonesty layer)
    const served = rawIndicationKg + this.#fidelity.servedOffsetKg - this.#zeroOffsetKg
    this.#lastIndication = { value: served, unit: 'kg', kind: 'mass' }
    this.#servedAt = this.#clock.now() - this.#fidelity.servedLagS
  }

  // ── TwinInstrumentView (the legal view) ──────────────────────────────

  indication(): Qty { return this.#lastIndication }
  servedAt(): number { return this.#servedAt }
  operationalState(): string { return this.#faulted ? 'fault' : 'ready' }
  environment(): Environment { return this.#env }

  // ── WorldInstrument (reality — /world only) ──────────────────────────

  groundTruth() {
    return {
      appliedLoadKg: this.#appliedLoadKg,
      strainMm: 0,
      spanDriftFraction: 0,
      thermalOffsetMVperV: 0,
      environment: this.#env,
      clockS: this.#clock.now(),
    }
  }
}
