// stages/gas-conditioning.ts — the gas-analyzer conditioning stage:
// raw detector signal → indicated ppm. Calibration references (zero/span
// — the R 144-1, 4.8 semi-automatic adjustment means), the
// density/T/flow corrections with residuals, additive cross-sensitivity
// (ndir band overlap; the cld quench already realized in transduction),
// the R 144 drift classes (24 h / 7-day zero + span rates), electronics
// noise, the response-time filter (T90), quantization to the scale
// interval. Corrections are relative to CALIBRATION conditions (the
// instrument reads correctly where it was calibrated; residual error
// grows with the deviation — the R 144-2 1.5–1.9 influence tests).
import { gasDensity } from './gas-transduction.js'

export interface GasConditioningParams {
  /** upper measuring-range value, ppm (R 144-1, 4.2 envelope-checked
   *  by the instrument definition, not the stage). */
  rangePpm: number
  scaleIntervalPpm: number
  /** the operator-configured span-gas value, ppm (device setting —
   *  spanCalibration maps the current raw signal onto this). */
  spanGasPpm: number
  /** response-time filter, seconds (T90 = τ·ln 10 ≤ 240 s per R 144-1, 4.6). */
  filterTauS: number
  noiseSigmaPpm: number
  /** residual temperature coefficients after compensation. */
  tcZeroPpmPerDegC: number
  tcSpanPerDegC: number
  /** conditions at the last factory calibration. */
  calibrationTempDegC: number
  calibrationPressureKPa: number
  /** fraction of the gas-density (P/T) effect left uncorrected, 0..1. */
  pressureCorrectionResidual: number
  /** sample-flow sensitivity: fraction of reading per L/min off the
   *  reference flow, clamped to ±flowBoundFraction. */
  flowSensitivityPerLpm: number
  flowBoundFraction: number
  referenceFlowLPerMin: number
  /** additive cross-sensitivity (ndir band overlap), ppm per vol%
   *  interferent, clamped to ±xsBoundPpm. cld channels carry 0. */
  xsCo2PpmPerPercent: number
  xsH2oPpmPerPercent: number
  xsBoundPpm: number
  /** R 144-1, 4.8 drift rates: zero (ppm/day) and span (fraction/day) —
   *  the 24 h and 7-day drift classes are these rates at their horizons. */
  zeroDriftPpmPerDay: number
  spanDriftPerDay: number
  /** the raw signal at zero gas at factory calibration (ndir: 0 AU;
   *  cld: the dark rate). */
  factoryZeroRaw: number
  /** factory span-reference error, fraction (+ reads low). */
  initialSpanErrorFraction: number
  /** the true signal-per-ppm at factory calibration (the honest span
   *  reference the factory error perturbs), raw units per ppm. */
  factorySpanRefPerPpm: number
}

export interface ConditioningContext {
  temperatureDegC: number
  pressureKPa: number
  flowLPerMin: number
  co2PercentVol: number
  h2oPercentVol: number
}

export class GasConditioningStage {
  #zeroRefRaw: number
  #spanRefPerPpm: number
  #zeroDriftPpm = 0
  #spanDriftFraction = 0
  #filtered = 0
  #primed = false

  constructor(private readonly p: GasConditioningParams, private readonly normal: () => number) {
    this.#zeroRefRaw = p.factoryZeroRaw
    this.#spanRefPerPpm = p.factorySpanRefPerPpm * (1 + p.initialSpanErrorFraction)
  }

  advance(dtS: number): void {
    this.#zeroDriftPpm += this.p.zeroDriftPpmPerDay * (dtS / 86400)
    this.#spanDriftFraction += this.p.spanDriftPerDay * (dtS / 86400)
  }

  /** Zero calibration (instrument-legal): capture the CURRENT raw
   *  signal as the zero reference. Uses whatever gas is in the cell —
   *  exactly like the real instrument; zero gas is the operator's job. */
  zeroCalibrate(rawNow: number): void { this.#zeroRefRaw = rawNow }

  /** Span calibration (instrument-legal): map the current raw signal
   *  onto the configured span-gas value. A wrong configured value (or
   *  the wrong gas in the cell) leaves a physically real span error. */
  spanCalibrate(rawNow: number): void {
    this.#spanRefPerPpm = (rawNow - this.#zeroRefRaw) / this.p.spanGasPpm
  }

  /** The calibration references (ground truth — /world only). */
  get zeroRefRaw(): number { return this.#zeroRefRaw }
  get spanRefPerPpm(): number { return this.#spanRefPerPpm }
  get zeroDriftPpm(): number { return this.#zeroDriftPpm }
  get spanDriftFraction(): number { return this.#spanDriftFraction }

  process(rawSignal: number, dtS: number, ctx: ConditioningContext): number {
    // calibration + density correction (relative to calibration
    // conditions; the residual leaves a fraction uncorrected)
    const density = gasDensity(ctx.temperatureDegC, ctx.pressureKPa)
    const densityCal = gasDensity(this.p.calibrationTempDegC, this.p.calibrationPressureKPa)
    const densityCorr = Math.pow(densityCal / density, 1 - this.p.pressureCorrectionResidual)
    let c = ((rawSignal - this.#zeroRefRaw) / this.#spanRefPerPpm) * densityCorr

    // residual temperature coefficients (zero additive, span multiplicative)
    const dT = ctx.temperatureDegC - this.p.calibrationTempDegC
    c = c * (1 + this.p.tcSpanPerDegC * dT) + this.p.tcZeroPpmPerDegC * dT

    // sample-flow sensitivity, bounded
    const flowErr = clamp(this.p.flowSensitivityPerLpm * (ctx.flowLPerMin - this.p.referenceFlowLPerMin),
      -this.p.flowBoundFraction, this.p.flowBoundFraction)
    c *= 1 + flowErr

    // additive cross-sensitivity (ndir band overlap), bounded
    const xs = clamp(this.p.xsCo2PpmPerPercent * ctx.co2PercentVol + this.p.xsH2oPpmPerPercent * ctx.h2oPercentVol,
      -this.p.xsBoundPpm, this.p.xsBoundPpm)
    c += xs

    // the R 144 drift classes: span multiplicative, zero additive
    c = c * (1 + this.#spanDriftFraction) + this.#zeroDriftPpm

    // electronics noise, then the response-time filter (T90), then
    // quantization to the scale interval
    c += this.normal() * this.p.noiseSigmaPpm
    if (!this.#primed) { this.#filtered = c; this.#primed = true }
    const alpha = 1 - Math.exp(-dtS / this.p.filterTauS)
    this.#filtered += (c - this.#filtered) * alpha
    c = this.#filtered
    return Math.round(c / this.p.scaleIntervalPpm) * this.p.scaleIntervalPpm
  }

  reset(): void {
    this.#zeroRefRaw = this.p.factoryZeroRaw
    this.#spanRefPerPpm = this.p.factorySpanRefPerPpm * (1 + this.p.initialSpanErrorFraction)
    this.#zeroDriftPpm = 0
    this.#spanDriftFraction = 0
    this.#filtered = 0
    this.#primed = false
  }
}

function clamp(x: number, lo: number, hi: number): number { return Math.min(hi, Math.max(lo, x)) }
