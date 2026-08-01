// gas-instrument.ts — the R 144 continuous gas monitor (CGM) composition
// root, the gas family's analogue of instrument.ts: transduction →
// conditioning per component channel, clock, environment, the gas bench.
// The epistemic wall (law 1) is here: indication()/operationalState()/
// environment() are the instrument's legal view (/twin); groundTruth()
// is reality, exposed to /world only. Calibration (zero/span) is an
// instrument-legal operation realized THROUGH the physics — it moves
// the conditioning stage's calibration references, never the indication.
import type { VirtualClock } from './time.js'
import { qty, type Qty } from './physics/quantity.js'
import { mulberry32, normal } from './physics/rng.js'
import {
  GasTransductionStage, gasDensity,
  type GasTransductionParams, type GasSample,
} from './physics/stages/gas-transduction.js'
import { GasConditioningStage, type GasConditioningParams } from './physics/stages/gas-conditioning.js'
import type { Environment } from './instrument.js'
import { REFERENCE_ENVIRONMENT } from './instrument.js'
import type { OperationalState } from './instrument.js'

export type GasComponent = 'co' | 'nox'
export const GAS_COMPONENTS: GasComponent[] = ['co', 'nox']

/** Ambient (room-air) composition a sample-line leak dilutes toward:
 *  CO2 0.04 vol%, H2O 1.2 vol% (50 %RH at 20 °C), measurands ≈ 0. */
export const AMBIENT_AIR = { co2PercentVol: 0.04, h2oPercentVol: 1.2 } as const

export interface GasChannelDefinition {
  component: GasComponent
  transduction: GasTransductionParams
  conditioning: Omit<GasConditioningParams, 'factoryZeroRaw' | 'factorySpanRefPerPpm'>
  /** decaying power-on zero offset, ppm (the optical bench and
   *  electronics thermal settling — CGMs warm up long). */
  warmUpOffsetPpm: number
}

export interface GasAnalyzerParameters {
  /** warm-up time constant, seconds; ready at 5τ (the declared warm-up
   *  time — R 144-1, 4.7 leaves it to the manufacturer). */
  warmUpTauS: number
  /** decaying power-on span residual, fraction. */
  warmUpSpanResidual: number
}

/** Fault state a definition may boot with (the scenario presets —
 *  physically realized, never an indication override). */
export interface InitialFaults {
  opticsContamination?: number
  sourceAgingRatePerDay?: number
}

export interface GasAnalyzerDefinition {
  id: string
  channels: GasChannelDefinition[]
  parameters: GasAnalyzerParameters
  initialFaults?: InitialFaults
}

export interface GasBench {
  coPpm: number
  noxPpm: number
  /** the NO2 share of NOx (combustion exhaust: a few percent). */
  no2Fraction: number
  co2PercentVol: number
  h2oPercentVol: number
  flowLPerMin: number
  sampleLineLeakFraction: number
}

export interface ChannelTruth {
  rawSignal: number
  zeroRefRaw: number
  spanRefPerPpm: number
  zeroDriftPpm: number
  spanDriftFraction: number
  contamination: number
  agingDriftAU: number
}

export interface GasGroundTruth {
  clockS: number
  environment: Environment
  bench: GasBench
  channels: Record<GasComponent, ChannelTruth>
  faultLatched: boolean
}

interface Channel {
  def: GasChannelDefinition
  trans: GasTransductionStage
  cond: GasConditioningStage
}

export class SimulatedGasAnalyzer {
  #def: GasAnalyzerDefinition
  #clock: VirtualClock
  #channels = new Map<GasComponent, Channel>()
  #env: Environment = { ...REFERENCE_ENVIRONMENT }
  #bench: GasBench
  /** The composite coupling port: source composition upstream of any
   *  sampling line. setGasConcentration writes here (and to #bench for
   *  standalone compatibility); the runtime's per-tick coupler reads
   *  this to feed a downstream sampling line. */
  #sourceCoPpm = 0
  #sourceNoxPpm = 0
  #poweredAt = 0
  #state: OperationalState = 'warming'
  #lastDt = 0.001
  #faultLatched = false
  #lastIndication = new Map<GasComponent, Qty>()

  constructor(def: GasAnalyzerDefinition, clock: VirtualClock, seed: number) {
    this.#def = def
    this.#clock = clock
    const rng = mulberry32(seed)
    for (const chDef of def.channels) {
      const trans = new GasTransductionStage({ ...chDef.transduction })
      const cond = new GasConditioningStage({
        ...chDef.conditioning,
        factoryZeroRaw: factoryZeroRaw(chDef),
        factorySpanRefPerPpm: factorySpanRefPerPpm(chDef),
      }, normal(rng))
      this.#channels.set(chDef.component, { def: chDef, trans, cond })
    }
    this.#bench = {
      coPpm: 0, noxPpm: 0, no2Fraction: 0.05,
      co2PercentVol: 0, h2oPercentVol: 0,
      flowLPerMin: def.channels[0]?.conditioning.referenceFlowLPerMin ?? 1,
      sampleLineLeakFraction: 0,
    }
    this.#poweredAt = clock.now()
    if (def.initialFaults?.opticsContamination !== undefined) {
      for (const ch of this.#channels.values()) ch.trans.setContamination(def.initialFaults.opticsContamination)
    }
    if (def.initialFaults?.sourceAgingRatePerDay !== undefined) {
      for (const ch of this.#channels.values()) ch.trans.setSourceAgingRate(def.initialFaults.sourceAgingRatePerDay)
    }
    clock.onAdvance(dt => this.#tick(dt))
  }

  #tick(dt: number): void {
    this.#lastDt = dt
    for (const ch of this.#channels.values()) { ch.trans.advance(dt); ch.cond.advance(dt) }
    if (this.#state === 'warming' && this.#clock.now() - this.#poweredAt >= 5 * this.#def.parameters.warmUpTauS) this.#state = 'ready'
  }

  #channel(component: GasComponent): Channel {
    const ch = this.#channels.get(component)
    if (!ch) throw new Error(`unknown component '${component}' (this analyzer measures: ${[...this.#channels.keys()].join(', ')})`)
    return ch
  }

  /** The gas actually in the cell (ground truth): the bench stream
   *  diluted by any sample-line leak toward ambient air. */
  #sample(component: GasComponent): GasSample {
    const leak = this.#bench.sampleLineLeakFraction
    const dilute = (x: number, ambient: number) => x * (1 - leak) + ambient * leak
    return {
      measurandPpm: dilute(component === 'co' ? this.#bench.coPpm : this.#bench.noxPpm, 0),
      no2Fraction: this.#bench.no2Fraction,
      co2PercentVol: dilute(this.#bench.co2PercentVol, AMBIENT_AIR.co2PercentVol),
      h2oPercentVol: dilute(this.#bench.h2oPercentVol, AMBIENT_AIR.h2oPercentVol),
      temperatureDegC: this.#env.temperatureDegC,
      pressureKPa: this.#env.pressureKPa,
    }
  }

  /** The raw detector signal right now (ground truth — /world only). */
  #raw(component: GasComponent): number {
    return this.#channel(component).trans.output(this.#sample(component))
  }

  // ── the world interface (simulated actions — never /twin) ──

  setGasConcentration(component: GasComponent, ppm: number): void {
    this.#channel(component) // validates the component
    if (!(ppm >= 0)) throw new Error(`concentration must be ≥ 0, got ${ppm}`)
    if (component === 'co') {
      this.#bench.coPpm = ppm
      this.#sourceCoPpm = ppm
    } else {
      this.#bench.noxPpm = ppm
      this.#sourceNoxPpm = ppm
    }
  }
  setNo2Fraction(fraction: number): void {
    if (!(fraction >= 0 && fraction <= 1)) throw new Error(`NO2 fraction must be in 0..1, got ${fraction}`)
    this.#bench.no2Fraction = fraction
  }
  setInterferents(i: { co2PercentVol?: number; h2oPercentVol?: number }): void {
    if (i.co2PercentVol !== undefined) {
      if (!(i.co2PercentVol >= 0)) throw new Error(`CO2 must be ≥ 0, got ${i.co2PercentVol}`)
      this.#bench.co2PercentVol = i.co2PercentVol
    }
    if (i.h2oPercentVol !== undefined) {
      if (!(i.h2oPercentVol >= 0)) throw new Error(`H2O must be ≥ 0, got ${i.h2oPercentVol}`)
      this.#bench.h2oPercentVol = i.h2oPercentVol
    }
  }

  /** The composite coupling port: the source composition upstream of
   *  any sampling line. setGasConcentration writes here (and to the
   *  bench for standalone compatibility); the runtime's per-tick
   *  coupler reads this to feed a downstream sampling line. */
  sourceComposition(): { coPpm: number; noxPpm: number } {
    return { coPpm: this.#sourceCoPpm, noxPpm: this.#sourceNoxPpm }
  }

  /** The composite coupling port: the runtime writes the sampling
   *  line's outlet composition here each tick. The bench then reflects
   *  what's actually reaching the analyzer cell (delayed + diluted). */
  setInletComposition(c: { coPpm?: number; noxPpm?: number; no2Fraction?: number; co2PercentVol?: number; h2oPercentVol?: number }): void {
    if (c.coPpm != null) this.#bench.coPpm = c.coPpm
    if (c.noxPpm != null) this.#bench.noxPpm = c.noxPpm
    if (c.no2Fraction != null) this.#bench.no2Fraction = c.no2Fraction
    if (c.co2PercentVol != null) this.#bench.co2PercentVol = c.co2PercentVol
    if (c.h2oPercentVol != null) this.#bench.h2oPercentVol = c.h2oPercentVol
  }

  setSampleFlow(lPerMin: number): void {
    if (!(lPerMin > 0)) throw new Error(`sample flow must be > 0, got ${lPerMin}`)
    this.#bench.flowLPerMin = lPerMin
  }
  setEnvironment(e: Partial<Environment>): void { this.#env = { ...this.#env, ...e } }

  /** Fault knobs (/world only) — each realizes through the stages. */
  setOpticsContamination(fraction: number): void {
    for (const ch of this.#channels.values()) ch.trans.setContamination(fraction)
  }
  setSourceAgingRate(perDay: number): void {
    for (const ch of this.#channels.values()) ch.trans.setSourceAgingRate(perDay)
  }
  setSampleLineLeak(fraction: number): void {
    if (!(fraction >= 0 && fraction <= 1)) throw new Error(`sample-line leak fraction must be in 0..1, got ${fraction}`)
    this.#bench.sampleLineLeakFraction = fraction
  }

  /** /world-only fault latch (parity with the load cell's gap-B2
   *  semantics): drive the operational state to fault and freeze the
   *  served indications until resolved. Never reachable from /twin. */
  injectFault(): void { this.#faultLatched = true }
  clearFault(): void { this.#faultLatched = false }

  // ── the instrument's legal view (/twin) ──

  /** The served indication for a component (the gas twin serves the
   *  per-component registers indication_co / indication_nox). The
   *  default exists for the TwinInstrumentView shape — a generic caller
   *  gets the first channel. */
  indication(component: GasComponent = 'co'): Qty {
    const latched = this.#lastIndication.get(component)
    if (this.#faultLatched && latched !== undefined) return latched
    const ch = this.#channel(component)
    const raw = this.#raw(component)
    let c = ch.cond.process(raw, this.#lastDt, {
      temperatureDegC: this.#env.temperatureDegC,
      pressureKPa: this.#env.pressureKPa,
      flowLPerMin: this.#bench.flowLPerMin,
      co2PercentVol: this.#sample(component).co2PercentVol,
      h2oPercentVol: this.#sample(component).h2oPercentVol,
    })
    // the warm-up envelope (instrument-level electronics/bench settling)
    const tau = this.#def.parameters.warmUpTauS
    const t = this.#clock.now() - this.#poweredAt
    const decay = tau > 0 ? Math.exp(-t / tau) : 0
    c = c * (1 - this.#def.parameters.warmUpSpanResidual * decay) + ch.def.warmUpOffsetPpm * decay
    const d = ch.def.conditioning.scaleIntervalPpm
    c = Math.round(c / d) * d
    const value = qty(c, 'ppm')
    if (!this.#faultLatched) this.#lastIndication.set(component, value)
    return value
  }

  servedAt(): number { return this.#clock.now() }
  operationalState(): OperationalState { return this.#faultLatched ? 'fault' : this.#state }
  environment(): Environment { return { ...this.#env } }

  /** Zero calibration (instrument-legal, /twin): capture the current
   *  raw signal as each channel's zero reference — through the physics,
   *  with whatever gas is in the cell (zero gas is the operator's job). */
  zeroCalibration(): void {
    for (const component of this.#channels.keys()) this.#channel(component).cond.zeroCalibrate(this.#raw(component))
  }

  /** Span calibration (instrument-legal, /twin): map the current raw
   *  signal onto each channel's configured span-gas value. */
  spanCalibration(): void {
    for (const component of this.#channels.keys()) this.#channel(component).cond.spanCalibrate(this.#raw(component))
  }

  // ── reality (/world only) ──

  get faultLatched(): boolean { return this.#faultLatched }

  groundTruth(): GasGroundTruth {
    const channels = {} as Record<GasComponent, ChannelTruth>
    for (const [component, ch] of this.#channels) {
      channels[component] = {
        rawSignal: this.#raw(component),
        zeroRefRaw: ch.cond.zeroRefRaw,
        spanRefPerPpm: ch.cond.spanRefPerPpm,
        zeroDriftPpm: ch.cond.zeroDriftPpm,
        spanDriftFraction: ch.cond.spanDriftFraction,
        contamination: ch.trans.contamination,
        agingDriftAU: ch.trans.agingDriftAU,
      }
    }
    return {
      clockS: this.#clock.now(),
      environment: { ...this.#env },
      bench: { ...this.#bench },
      channels,
      faultLatched: this.#faultLatched,
    }
  }

  reset(): void {
    for (const ch of this.#channels.values()) { ch.trans.reset(); ch.cond.reset() }
    this.#bench = {
      coPpm: 0, noxPpm: 0, no2Fraction: 0.05,
      co2PercentVol: 0, h2oPercentVol: 0,
      flowLPerMin: this.#def.channels[0]?.conditioning.referenceFlowLPerMin ?? 1,
      sampleLineLeakFraction: 0,
    }
    this.#env = { ...REFERENCE_ENVIRONMENT }
    this.#poweredAt = this.#clock.now()
    this.#state = 'warming'
    this.#faultLatched = false
    this.#lastIndication.clear()
  }
}

/** The factory zero reference: the raw signal at zero gas under
 *  factory-calibration conditions (ndir: no absorbance; cld: dark rate). */
function factoryZeroRaw(chDef: GasChannelDefinition): number {
  const p = chDef.transduction
  return p.principle === 'cld' ? p.darkRate : 0
}

/** The factory span reference: raw signal per ppm at the calibration
 *  conditions (span gas is NO — the converter does not act on it). */
function factorySpanRefPerPpm(chDef: GasChannelDefinition): number {
  const p = chDef.transduction
  const densityCal = gasDensity(chDef.conditioning.calibrationTempDegC, chDef.conditioning.calibrationPressureKPa)
  return (p.principle === 'ndir' ? p.absorbancePerPpm : p.photonRatePerPpm) * densityCal
}

/** The reference CGM good-analyzer definition (R 144 territory):
 *  CO by ndir, NOx by cld. Ranges sit inside the R 144-1, 4.2 envelopes
 *  (CO 10–20000 ppm; NOx = NO+NO2 20–5500 ppm) — 0–1000 ppm CO and
 *  0–500 ppm NOx are representative stationary-source sub-ranges. All
 *  coefficients inside the R 144 limits: 7-day drift < MPE
 *  (max(2 ppm, 5 %) — R 144-1, 4.8), cross-sensitivity < 0.5·MPE at the
 *  declared interferent maxima (CO2/H2O 20 vol% — 4.5.2), T90 ≈ 69 s
 *  < 240 s (4.6), warm-up 1 h (4.7, manufacturer-declared). */
export const GAS_ANALYZER_GOOD: GasAnalyzerDefinition = {
  id: 'cgm200-good',
  parameters: { warmUpTauS: 720, warmUpSpanResidual: 0.005 },
  channels: [
    {
      component: 'co',
      transduction: {
        principle: 'ndir',
        absorbancePerPpm: 2.0e-4,
        sourceAgingCompensation: 0.95,
        contaminationAbsorbance: 0.05,
      },
      conditioning: {
        rangePpm: 1000, scaleIntervalPpm: 0.1, spanGasPpm: 800,
        filterTauS: 30, noiseSigmaPpm: 0.05,
        tcZeroPpmPerDegC: 0.01, tcSpanPerDegC: 2.0e-5,
        calibrationTempDegC: 20, calibrationPressureKPa: 101.325,
        pressureCorrectionResidual: 0.02,
        flowSensitivityPerLpm: 0.002, flowBoundFraction: 0.05, referenceFlowLPerMin: 1.0,
        xsCo2PpmPerPercent: 0.1, xsH2oPpmPerPercent: 0.08, xsBoundPpm: 5,
        zeroDriftPpmPerDay: 0.15, spanDriftPerDay: 0.001,
        initialSpanErrorFraction: 0,
      },
      warmUpOffsetPpm: 10,
    },
    {
      component: 'nox',
      transduction: {
        principle: 'cld',
        photonRatePerPpm: 1000, darkRate: 500,
        converterEfficiency: 0.96,
        quenchPerPercentCo2: 3.0e-4, quenchPerPercentH2o: 6.0e-4,
      },
      conditioning: {
        rangePpm: 500, scaleIntervalPpm: 0.1, spanGasPpm: 400,
        filterTauS: 30, noiseSigmaPpm: 0.05,
        tcZeroPpmPerDegC: 0.01, tcSpanPerDegC: 2.0e-5,
        calibrationTempDegC: 20, calibrationPressureKPa: 101.325,
        pressureCorrectionResidual: 0.02,
        flowSensitivityPerLpm: 0.002, flowBoundFraction: 0.05, referenceFlowLPerMin: 1.0,
        xsCo2PpmPerPercent: 0, xsH2oPpmPerPercent: 0, xsBoundPpm: 5,
        zeroDriftPpmPerDay: 0.1, spanDriftPerDay: 0.001,
        initialSpanErrorFraction: 0,
      },
      warmUpOffsetPpm: 5,
    },
  ],
}
