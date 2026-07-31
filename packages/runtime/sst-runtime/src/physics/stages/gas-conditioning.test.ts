import { describe, it, expect } from 'vitest'
import { mulberry32, normal } from '../rng.js'
import { GasConditioningStage, type GasConditioningParams, type ConditioningContext } from './gas-conditioning.js'
import { gasDensity } from './gas-transduction.js'

// a CO-channel-like parameter set; factory span ref = k · density at the
// calibration conditions (20 °C, 101.325 kPa)
const K = 2.0e-4
const DENSITY_CAL = gasDensity(20, 101.325)
const base: GasConditioningParams = {
  rangePpm: 1000, scaleIntervalPpm: 0.1, spanGasPpm: 800,
  filterTauS: 30, noiseSigmaPpm: 0,
  tcZeroPpmPerDegC: 0.01, tcSpanPerDegC: 2.0e-5,
  calibrationTempDegC: 20, calibrationPressureKPa: 101.325,
  pressureCorrectionResidual: 0,
  flowSensitivityPerLpm: 0.002, flowBoundFraction: 0.05, referenceFlowLPerMin: 1,
  xsCo2PpmPerPercent: 0.1, xsH2oPpmPerPercent: 0.08, xsBoundPpm: 5,
  zeroDriftPpmPerDay: 0.15, spanDriftPerDay: 0.001,
  factoryZeroRaw: 0, initialSpanErrorFraction: 0,
  factorySpanRefPerPpm: K * DENSITY_CAL,
}
const CAL: ConditioningContext = {
  temperatureDegC: 20, pressureKPa: 101.325, flowLPerMin: 1, co2PercentVol: 0, h2oPercentVol: 0,
}
const rawAt = (ppm: number, ctx: ConditioningContext = CAL) => K * ppm * gasDensity(ctx.temperatureDegC, ctx.pressureKPa)

function make(over: Partial<GasConditioningParams> = {}) {
  return new GasConditioningStage({ ...base, ...over }, normal(mulberry32(7)))
}
/** the 0.1 ppm quantization grid — expectations align to it */
const q = (x: number) => Math.round(x / 0.1) * 0.1
/** settle the filter at a fixed raw value (fully converged) */
function settle(s: GasConditioningStage, raw: number, ctx: ConditioningContext = CAL): number {
  let out = 0
  for (let i = 0; i < 1000; i++) out = s.process(raw, 1.0, ctx)
  return out
}

describe('GasConditioningStage — calibration round-trip', () => {
  it('reads the applied concentration at the calibration conditions', () => {
    expect(settle(make(), rawAt(800))).toBeCloseTo(800, 6)
    expect(settle(make(), rawAt(100))).toBeCloseTo(100, 6)
  })
  it('quantizes to the scale interval', () => {
    const out = settle(make(), rawAt(123.456))
    expect(out * 10 % 1).toBeCloseTo(0, 9)
    expect(out).toBeCloseTo(123.5, 6)
  })
})

describe('GasConditioningStage — the influence corrections (signs and bounds)', () => {
  it('perfect pressure/density correction at residual 0 (the R 144-2, 1.8 story)', () => {
    const ctx: ConditioningContext = { ...CAL, pressureKPa: 106 }
    expect(settle(make(), rawAt(800, ctx), ctx)).toBeCloseTo(800, 6)
  })
  it('pressure UP reads HIGH when uncorrected (residual 1) — more molecules in the path', () => {
    const s = make({ pressureCorrectionResidual: 1 })
    const ctx: ConditioningContext = { ...CAL, pressureKPa: 106 }
    const out = settle(s, rawAt(800, ctx), ctx)
    expect(out).toBeCloseTo(q(800 * (gasDensity(20, 106) / DENSITY_CAL)), 6)
    expect(out).toBeGreaterThan(800)
  })
  it('temperature UP at fixed pressure reads LOW when uncorrected (residual 1)', () => {
    const s = make({ pressureCorrectionResidual: 1, tcSpanPerDegC: 0, tcZeroPpmPerDegC: 0 })
    const ctx: ConditioningContext = { ...CAL, temperatureDegC: 40 }
    const out = settle(s, rawAt(800, ctx), ctx)
    expect(out).toBeCloseTo(q(800 * (gasDensity(40, 101.325) / DENSITY_CAL)), 6)
    expect(out).toBeLessThan(800)
  })
  it('the residual leaves exactly that fraction of the density effect', () => {
    const s = make({ pressureCorrectionResidual: 0.25 })
    const ctx: ConditioningContext = { ...CAL, pressureKPa: 106 }
    const ratio = gasDensity(20, 106) / DENSITY_CAL
    expect(settle(s, rawAt(800, ctx), ctx)).toBeCloseTo(q(800 * Math.pow(ratio, 0.25)), 6)
  })
  it('flow sensitivity is multiplicative and BOUNDED', () => {
    const high = settle(make(), rawAt(800), { ...CAL, flowLPerMin: 1.5 })
    expect(high).toBeCloseTo(q(800 * 1.001), 6)
    const extreme = settle(make(), rawAt(800), { ...CAL, flowLPerMin: 100 })
    expect(extreme).toBeCloseTo(q(800 * 1.05), 6) // clamped at flowBoundFraction
  })
  it('cross-sensitivity is additive and BOUNDED (the R 144-1, 4.5.2 knob)', () => {
    const zero = settle(make(), rawAt(100))
    const wet = settle(make(), rawAt(100), { ...CAL, co2PercentVol: 20, h2oPercentVol: 20 })
    expect(wet).toBeCloseTo(q(100 + 0.1 * 20 + 0.08 * 20), 6)
    expect(wet).toBeGreaterThan(zero)
    const saturated = settle(make(), rawAt(100), { ...CAL, co2PercentVol: 1000 })
    expect(saturated).toBeCloseTo(q(100 + 5), 6) // clamped at xsBoundPpm
  })
  it('residual temperature coefficients act on zero (additive) and span (multiplicative)', () => {
    const ctx: ConditioningContext = { ...CAL, temperatureDegC: 40 }
    const out = settle(make({ pressureCorrectionResidual: 0 }), rawAt(800, ctx), ctx)
    expect(out).toBeCloseTo(q(800 * (1 + 2.0e-5 * 20) + 0.01 * 20), 6)
  })
})

describe('GasConditioningStage — the R 144 drift classes (4.8)', () => {
  it('zero drift accumulates linearly; span drift multiplies — the 24 h and 7-day horizons', () => {
    const s = make()
    settle(s, rawAt(800))
    s.advance(86400) // 24 h
    const day1 = settle(s, rawAt(800))
    expect(day1).toBeCloseTo(q(800 * 1.001 + 0.15), 6)
    s.advance(6 * 86400) // day 7
    const day7 = settle(s, rawAt(800))
    expect(day7).toBeCloseTo(q(800 * 1.007 + 1.05), 6)
    expect(day7 - 800).toBeGreaterThan(day1 - 800)
  })
})

describe('GasConditioningStage — the response-time filter (R 144-1, 4.6)', () => {
  it('reaches 90 % of a step at τ·ln 10 (T90 ≈ 69 s at τ = 30 s)', () => {
    const s = make()
    settle(s, rawAt(0))
    const out = s.process(rawAt(450), 30 * Math.LN10, CAL)
    expect(out).toBeCloseTo(q(450 * 0.9), 3)
  })
})

describe('GasConditioningStage — calibration operations move the references, never the indication', () => {
  it('zeroCalibrate absorbs a constant raw offset (contamination between calibrations)', () => {
    const s = make()
    const contaminatedZero = rawAt(0) + 0.005
    expect(settle(s, contaminatedZero)).toBeCloseTo(q(0.005 / (K * DENSITY_CAL)), 6)
    s.zeroCalibrate(contaminatedZero)
    expect(settle(s, contaminatedZero)).toBeCloseTo(0, 6)
    // and the span response survives: 800 ppm on top of the absorbed offset
    expect(settle(s, contaminatedZero + rawAt(800))).toBeCloseTo(800, 1)
  })
  it('spanCalibrate maps the current raw onto the CONFIGURED span value — a wrong key-in leaves a real span error', () => {
    const s = make({ spanGasPpm: 700 }) // operator keys 700 but the cylinder is truly 800
    s.spanCalibrate(rawAt(800))
    expect(settle(s, rawAt(800))).toBeCloseTo(700, 6)
    expect(settle(s, rawAt(400))).toBeCloseTo(350, 6) // multiplicative error
  })
  it('an initial span-reference error reads low multiplicatively until spanCalibrate cures it', () => {
    const s = make({ initialSpanErrorFraction: 0.06 })
    expect(settle(s, rawAt(800))).toBeCloseTo(q(800 / 1.06), 6)
    s.spanCalibrate(rawAt(800))
    expect(settle(s, rawAt(800))).toBeCloseTo(800, 3)
  })
})
