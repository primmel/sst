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
import {
  LoadApplicationDevice,
  type LadSpec,
  type LadState,
} from '../physics/devices/load-application-device.js'
import {
  ClimaticChamber,
  type ChamberSpec,
  type ChamberState,
} from '../physics/devices/climatic-chamber.js'
import {
  IndicatingInstrument,
  type IndicatorSpec,
  type IndicatorState,
} from '../physics/devices/indicating-instrument.js'

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
    // The bench's load application device (R 60-2, 2.7.2 — the
    // force-generating system; see physics/devices/load-application-device.ts).
    // Null until configured (coefficients lad_* or configureLad()); while
    // engaged it OWNS #appliedLoadKg through its ramp.
    #lad: LoadApplicationDevice | null = null
    // The bench's climatic chamber (R 60-3, 4.10.3/4.10.4): while engaged
    // it OWNS the environment's temperature (and humidity, when the
    // chamber has humidity control) through its ramp/soak/hold dynamics.
    #chamber: ClimaticChamber | null = null
    // The bench's indicating instrument (R 60-2, 2.7.2's second half):
    // for analogue-passive stacks it forms the reading from the cell's
    // bridge output — the served indication is the LAB instrument's
    // reading, calibration state and all.
    #indicator: IndicatingInstrument | null = null
    #stack: string
    #rng: () => number
    /** The instance's raw coefficients, kept for the LAD's lad_* defaults. */
    #ladCoefficients: Record<string, number>
    // The warm-up arc (TODO.integration/06 gap 2): the cell powers on at
    // 'warming' and settles to 'ready' at 5 × warm_up_tau_s — the same
    // law as SimulatedInstrument (instrument.ts:95).
    #state: 'warming' | 'ready' | 'fault' = 'warming'
    #poweredAt: number
    #warmUpTauS: number

    constructor(
      config: ComposedInstrumentConfig,
      clock: VirtualClock,
      seed: number,
    ) {
      this.#clock = clock
      this.#poweredAt = clock.now()
      this.#warmUpTauS = config.coefficients['warm_up_tau_s'] ?? 60
      this.#rng = mulberry32(seed + 7)
      this.#ladCoefficients = config.coefficients
      this.#stack = config.classification.stack
      this.#fidelity = {
        servedOffsetKg: config.fidelity?.servedOffsetKg ?? 0,
        servedLagS: config.fidelity?.servedLagS ?? 0,
      }
      // The bench's force machine: present from boot when the instance
      // declares it (coefficients lad_capacity_kg + class/repeatability/
      // rate); otherwise configureLad() creates it on demand.
      if (typeof config.coefficients['lad_capacity_kg'] === 'number') {
        this.configureLad({})
      }
      // The bench's climatic chamber (coefficients chamber_*); the
      // indicating instrument follows for analogue-passive stacks that
      // declare it (indicator_* coefficients).
      if (typeof config.coefficients['chamber_temp_ramp_degC_per_min'] === 'number') {
        this.configureChamber({})
      }
      if (this.#stack === 'analog-passive' && typeof config.coefficients['indicator_gain_error_fraction'] === 'number') {
        this.configureIndicator({})
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

  placeMass(massKg: number): void { this.#lad?.disengage(); this.#appliedLoadKg = massKg }
  removeMass(): void { this.#lad?.disengage(); this.#appliedLoadKg = 0 }

  // ── The load application device (R 60-2, 2.7.2) ─────────────────────
  // The laboratory's force-generating system: ramps the load at a
  // controlled rate (no shock, 2.7.3.3), realizes it with the machine's
  // systematic class error + per-application repeatability, and OWNS the
  // applied load while engaged. The direct placeMass/removeMass path
  // (idealized deadweight placement) disengages it.

  /** Create or reconfigure the device. Explicit spec fields win over the
   *  instance's coefficient defaults (lad_capacity_kg,
   *  lad_class_fraction, lad_repeatability_fraction,
   *  lad_default_rate_kg_per_s), which win over the built-in defaults
   *  (3× the cell's capacity, ISO 376 class 0.5 analog, 0.02 %, 25 kg/s). */
  configureLad(spec: Partial<LadSpec>): void {
    const c = this.#ladCoefficients
    const merged: LadSpec = {
      capacityKg: spec.capacityKg ?? c['lad_capacity_kg'] ?? 3 * (c['capacity_kg'] ?? 500),
      classFraction: spec.classFraction ?? c['lad_class_fraction'] ?? 0.0005,
      repeatabilityFraction: spec.repeatabilityFraction ?? c['lad_repeatability_fraction'] ?? 0.0002,
      defaultRateKgPerS: spec.defaultRateKgPerS ?? c['lad_default_rate_kg_per_s'] ?? 25,
    }
    this.#lad = new LoadApplicationDevice(merged, this.#rng)
  }

  /** Ramp toward the nominal target load (kg). */
  ladApply(targetKg: number, rateKgPerS?: number): void {
    if (!this.#lad) this.configureLad({})
    this.#lad!.apply(targetKg, rateKgPerS)
  }

  /** Ramp back to the dead load. */
  ladRelease(rateKgPerS?: number): void {
    if (!this.#lad) this.configureLad({})
    this.#lad!.release(rateKgPerS)
  }

  /** The device's state (null when the bench has no device configured). */
  ladState(): LadState | null {
    return this.#lad ? this.#lad.state() : null
  }

  // ── The climatic chamber (R 60-3, 4.10.3/4.10.4) ────────────────────
  // The environmental equipment: ramps the climate at its rated rate,
  // overshoots slightly on approach, holds with its temporal stability.
  // While engaged it owns the environment's temperature (and humidity
  // when humidity-controlled); the direct setEnvironment path
  // (idealized, instantaneous) disengages it.

  /** Create or reconfigure the chamber. Explicit spec fields win over
   *  the instance's chamber_* coefficient defaults, which win over the
   *  built-in defaults — the realistic 600 L chamber class (per the
   *  IEC 60068-3-5 ratings of real chambers: 3 °C/min ramp, ±0.2 °C
   *  temporal stability, 0.4 °C approach overshoot, humidity control at
   *  5 %RH/min ±1.5 %RH). */
  configureChamber(spec: Partial<ChamberSpec>): void {
    const c = this.#ladCoefficients
    this.#chamber = new ClimaticChamber({
      tempRampDegCPerMin: spec.tempRampDegCPerMin ?? c['chamber_temp_ramp_degC_per_min'] ?? 3,
      tempStabilityDegC: spec.tempStabilityDegC ?? c['chamber_temp_stability_degC'] ?? 0.2,
      tempOvershootDegC: spec.tempOvershootDegC ?? c['chamber_temp_overshoot_degC'] ?? 0.4,
      humidityControl: spec.humidityControl ?? (c['chamber_humidity_control'] !== 0),
      humidityRampPercentRhPerMin: spec.humidityRampPercentRhPerMin ?? c['chamber_humidity_ramp_percent_rh_per_min'] ?? 5,
      humidityStabilityPercentRh: spec.humidityStabilityPercentRh ?? c['chamber_humidity_stability_percent_rh'] ?? 1.5,
    }, this.#rng)
  }

  /** Drive the chamber toward the setpoints (temperature always;
   *  humidity only when the chamber controls it and a value is given). */
  chamberSet(tempDegC: number, humidityPercentRh?: number): void {
    if (!this.#chamber) this.configureChamber({})
    this.#chamber!.set(tempDegC, humidityPercentRh)
  }

  /** Switch the chamber off (the climate drifts back to the lab ambient). */
  chamberOff(): void {
    this.#chamber?.off()
  }

  /** The chamber's state (null when the bench has none). */
  chamberState(): ChamberState | null {
    return this.#chamber ? this.#chamber.state() : null
  }

  // ── The indicating instrument (R 60-2, 2.7.2) ───────────────────────
  // For analogue-passive stacks the cell presents a bridge signal and
  // the LAB's indicator forms the reading — with its own calibration
  // state, scale interval and noise.

  /** Create or reconfigure the bench indicator. */
  configureIndicator(spec: Partial<IndicatorSpec>): void {
    const c = this.#ladCoefficients
    const kgPerMVperV = spec.kgPerMVperV
      ?? (c['capacity_kg'] ?? 500) / Math.max(c['sensitivity_mVperV'] ?? 2.0, 0.001)
    this.#indicator = new IndicatingInstrument({
      kgPerMVperV,
      gainErrorFraction: spec.gainErrorFraction ?? c['indicator_gain_error_fraction'] ?? 0.00003,
      offsetKg: spec.offsetKg ?? c['indicator_offset_kg'] ?? 0,
      scaleIntervalKg: spec.scaleIntervalKg ?? c['indicator_scale_interval_kg'] ?? c['scale_interval_kg'] ?? 0.05,
      noiseSigmaKg: spec.noiseSigmaKg ?? c['indicator_noise_sigma_kg'] ?? 0.002,
    }, normalRng(mulberry32(99)))
  }

  /** The bench indicator's state (null when the bench has none). */
  indicatorState(): IndicatorState | null {
    return this.#indicator ? this.#indicator.state() : null
  }
  setEnvironment(e: Partial<Environment>): void {
    // The direct climate path is the idealized, instantaneous one — it
    // disengages the chamber (the two actuators never share a channel).
    if (e.temperatureDegC !== undefined || e.humidityPercentRh !== undefined) this.#chamber?.off()
    this.#env = { ...this.#env, ...e }
  }
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
    this.#lad?.disengage()
    this.#chamber?.off()
    this.#env = { temperatureDegC: 20, humidityPercentRh: 50, pressureKPa: 101.325 }
    this.#lastIndication = { value: 0, unit: 'kg', kind: 'mass' }
    this.#servedAt = 0
    this.#state = 'warming'
    this.#poweredAt = this.#clock.now()
  }

  // ── Signal chain (called on each tick) ───────────────────────────────

  tick(dtS: number): void {
    this.#settleWarmUp()
    // The engaged force machine drives the applied load through its ramp
    // (the cell feels the machine's REALIZED load, never the nominal one).
    if (this.#lad) {
      const ladState = this.#lad.state()
      if (ladState.engaged) {
        this.#lad.advance(dtS)
        this.#appliedLoadKg = this.#lad.actualKg()
      }
    }
    // The engaged chamber drives the climate through its ramp/soak/hold
    // (the cell soaks after the air per its own thermal constants).
    if (this.#chamber) {
      const chState = this.#chamber.state()
      if (chState.engaged || chState.phase !== 'off') {
        this.#chamber.advance(dtS)
        this.#env = { ...this.#env, temperatureDegC: this.#chamber.actualTemperatureDegC() }
        const rh = this.#chamber.actualHumidityPercentRh()
        if (rh !== null) this.#env = { ...this.#env, humidityPercentRh: rh }
      }
    }
    let rawIndicationKg: number
    if (this.#dataDriven) {
      // Data-driven path: pipe through the chain declared in physics-chain.yaml
      const out = this.#dataDriven.tick(
        { applied_load_kg: this.#appliedLoadKg },
        { dtS, env: this.#env, nowS: this.#clock.now() },
      )
      // The bench indicator forms the reading for analogue-passive
      // stacks (the cell's legal output is the bridge signal; the LAB
      // instrument's reading is what the operator records).
      if (this.#indicator && this.#stack === 'analog-passive' && typeof out['bridge_mV_per_V'] === 'number') {
        rawIndicationKg = this.#indicator.read(out['bridge_mV_per_V'])
      } else {
        rawIndicationKg = out['indication_kg'] ?? 0
      }
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
      if (this.#indicator && this.#stack === 'analog-passive') {
        rawIndicationKg = this.#indicator.read(bridgeMVperV)
      } else {
        const condOut = this.#cond.process(bridgeMVperV, dtS, this.#env, this.#fixedKgPerMVperV)
        rawIndicationKg = condOut.indicationKg
      }
    }

    // Apply twin-fidelity knobs + zero offset (the epistemic wall's dishonesty layer)
    const served = rawIndicationKg + this.#fidelity.servedOffsetKg - this.#zeroOffsetKg
    this.#lastIndication = { value: served, unit: 'kg', kind: 'mass' }
    this.#servedAt = this.#clock.now() - this.#fidelity.servedLagS
  }

  // ── TwinInstrumentView (the legal view) ──────────────────────────────

  indication(): Qty { return this.#lastIndication }
  servedAt(): number { return this.#servedAt }
  operationalState(): string {
    // The arc settles lazily at read too — a consumer reading state
    // before any tick (or right at the boundary) sees the truth.
    this.#settleWarmUp()
    return this.#faulted ? 'fault' : this.#state
  }

  #settleWarmUp(): void {
    if (this.#state === 'warming' && this.#clock.now() - this.#poweredAt >= 5 * this.#warmUpTauS) this.#state = 'ready'
  }
  environment(): Environment { return this.#env }

  // ── WorldInstrument (reality — /world only) ──────────────────────────

  groundTruth() {
    // The mechanical internals, never stubs: the data-driven path reads
    // them from the chain's stage states; the legacy path from the
    // directly-wired stages. spanDriftFraction is honestly 0 — the
    // R 60 conditioning stage models no span drift in this physics.
    let strainMm = 0
    let thermalOffsetMVperV = 0
    if (this.#dataDriven) {
      const states = this.#dataDriven.stageStates()
      for (const state of Object.values(states)) {
        if (typeof state['strainMm'] === 'number') strainMm = state['strainMm']
        if (typeof state['thermalOffsetMVperV'] === 'number') thermalOffsetMVperV = state['thermalOffsetMVperV']
      }
    } else {
      strainMm = this.#mech.strainMm
      thermalOffsetMVperV = this.#trans.thermalOffsetMVperV
    }
    return {
      appliedLoadKg: this.#appliedLoadKg,
      strainMm,
      spanDriftFraction: 0,
      thermalOffsetMVperV,
      environment: this.#env,
      clockS: this.#clock.now(),
      // The bench's force machine (null when the instance declares none).
      lad: this.ladState(),
      // The bench's climatic chamber and indicating instrument (null
      // likewise — the bench carries only what the instance declares).
      chamber: this.chamberState(),
      indicator: this.indicatorState(),
    }
  }
}
