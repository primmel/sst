import { describe, it, expect } from 'vitest'
import {
  GasTransductionStage, gasDensity, GAS_REFERENCE,
  type NdirTransductionParams, type CldTransductionParams, type GasSample,
} from './gas-transduction.js'

const ndir: NdirTransductionParams = {
  principle: 'ndir', absorbancePerPpm: 2.0e-4,
  sourceAgingCompensation: 0.95, contaminationAbsorbance: 0.05,
}
const cld: CldTransductionParams = {
  principle: 'cld', photonRatePerPpm: 1000, darkRate: 500,
  converterEfficiency: 0.96, quenchPerPercentCo2: 3.0e-4, quenchPerPercentH2o: 6.0e-4,
}

function sample(over: Partial<GasSample> = {}): GasSample {
  return {
    measurandPpm: 0, no2Fraction: 0, co2PercentVol: 0, h2oPercentVol: 0,
    temperatureDegC: 0, pressureKPa: GAS_REFERENCE.pressureKPa, // density 1
    ...over,
  }
}

describe('gasDensity (the R 144 reference reduction, 4.1)', () => {
  it('is 1 at the reference conditions (273.15 K, 101.325 kPa)', () => {
    expect(gasDensity(0, 101.325)).toBeCloseTo(1, 9)
  })
  it('rises with pressure, falls with temperature (ideal gas)', () => {
    expect(gasDensity(0, 106)).toBeCloseTo(106 / 101.325, 6)
    expect(gasDensity(20, 101.325)).toBeCloseTo(273.15 / 293.15, 6)
    expect(gasDensity(0, 106)).toBeGreaterThan(gasDensity(0, 101.325))
    expect(gasDensity(40, 101.325)).toBeLessThan(gasDensity(20, 101.325))
  })
})

describe('GasTransductionStage — ndir (CO, Beer–Lambert)', () => {
  it('absorbance is linear in concentration; the implied transmittance is exponential (physically shaped, not a gain knob)', () => {
    const s = new GasTransductionStage(ndir)
    const a500 = s.output(sample({ measurandPpm: 500 }))
    const a1000 = s.output(sample({ measurandPpm: 1000 }))
    expect(a500).toBeCloseTo(0.1, 9)
    expect(a1000).toBeCloseTo(0.2, 9)
    // Beer–Lambert: T = exp(−A) — halving the path concentration squares the transmittance ratio
    expect(Math.exp(-a1000)).toBeCloseTo(Math.exp(-a500) ** 2, 12)
  })
  it('responds to number density: more molecules in the path at higher pressure', () => {
    const s = new GasTransductionStage(ndir)
    const atRef = s.output(sample({ measurandPpm: 1000 }))
    const atHigh = s.output(sample({ measurandPpm: 1000, pressureKPa: 106 }))
    expect(atHigh).toBeCloseTo(atRef * gasDensity(0, 106), 9)
    expect(atHigh).toBeGreaterThan(atRef)
  })
  it('optics contamination ADDS absorbance in the measurement path (a zero offset between calibrations)', () => {
    const s = new GasTransductionStage(ndir)
    s.setContamination(0.5)
    expect(s.output(sample())).toBeCloseTo(0.025, 9)
    expect(s.contamination).toBe(0.5)
  })
  it('source aging drifts the zero by the uncompensated fraction of the intensity loss', () => {
    const s = new GasTransductionStage(ndir)
    s.setSourceAgingRate(0.02) // 2 %/day intensity loss, 95 % reference-beam compensated
    s.advance(86400)
    expect(s.agingDriftAU).toBeCloseTo((1 - 0.95) * 0.02, 12)
    expect(s.output(sample())).toBeCloseTo(0.001, 9)
    s.advance(6 * 86400)
    expect(s.agingDriftAU).toBeCloseTo(0.007, 12)
  })
  it('rejects out-of-range fault knobs; reset clears the fault state', () => {
    const s = new GasTransductionStage(ndir)
    expect(() => s.setContamination(1.5)).toThrow(/0\.\.1/)
    expect(() => s.setSourceAgingRate(-1)).toThrow(/≥ 0/)
    s.setContamination(0.5); s.setSourceAgingRate(0.02); s.advance(86400)
    s.reset()
    expect(s.output(sample())).toBe(0)
    expect(s.agingDriftAU).toBe(0)
  })
})

describe('GasTransductionStage — cld (NOx, chemiluminescence)', () => {
  it('the photon rate is linear in concentration above the dark baseline', () => {
    const s = new GasTransductionStage(cld)
    expect(s.output(sample())).toBe(500) // dark counts
    const r200 = s.output(sample({ measurandPpm: 200 })) - 500
    const r400 = s.output(sample({ measurandPpm: 400 })) - 500
    expect(r400).toBeCloseTo(2 * r200, 6)
  })
  it('only the NO2 share passes the converter (efficiency η)', () => {
    const s = new GasTransductionStage(cld)
    const allNo = s.output(sample({ measurandPpm: 400, no2Fraction: 0 }))
    const allNo2 = s.output(sample({ measurandPpm: 400, no2Fraction: 1 }))
    expect(allNo2 - 500).toBeCloseTo((allNo - 500) * 0.96, 6)
    expect(allNo2).toBeLessThan(allNo)
  })
  it('CO2/H2O quench the emission by the Stern–Volmer law (multiplicative, physically shaped)', () => {
    const s = new GasTransductionStage(cld)
    const dry = s.output(sample({ measurandPpm: 400 }))
    const wet = s.output(sample({ measurandPpm: 400, co2PercentVol: 20, h2oPercentVol: 20 }))
    const q = 1 / (1 + 3.0e-4 * 20 + 6.0e-4 * 20)
    expect(wet - 500).toBeCloseTo((dry - 500) * q, 3)
    expect(wet).toBeLessThan(dry)
  })
  it('optics contamination attenuates photon collection multiplicatively (a span loss, no zero shift)', () => {
    const s = new GasTransductionStage(cld)
    const clean = s.output(sample({ measurandPpm: 400 }))
    s.setContamination(0.1)
    const dirty = s.output(sample({ measurandPpm: 400 }))
    expect(dirty).toBeCloseTo(clean * 0.9, 6)
    // and the dark baseline attenuates too — the ZERO (baseline-subtracted) is unaffected
    expect(dirty - 500 * 0.9).toBeCloseTo((clean - 500) * 0.9, 6)
  })
})
