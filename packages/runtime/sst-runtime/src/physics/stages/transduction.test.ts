import { describe, it, expect } from 'vitest'
import { TransductionStage, type TransductionParams } from './transduction.js'

const P: TransductionParams = {
  sensitivityMVperV: 2.0, gaugeFactor: 2.0, excitationV: 10,
  tcZeroPerDegC: 0.0001, tcSpanPerDegC: 0.0002,
  barometricPerKPa: 0.00005, referenceTempDegC: 20, referencePressureKPa: 101.325,
  thermalHysteresisPerDegC: 0.00002, thermalHysteresisTauS: 3600,
}

describe('TransductionStage', () => {
  const t = new TransductionStage(P)
  const envRef = { temperatureDegC: 20, pressureKPa: 101.325 }
  it('reference environment: output = sensitivity × strain (normalized)', () => {
    expect(t.output(0.001, envRef)).toBeCloseTo(2.0 * 0.001, 12)
  })
  it('span scales with (1 + tcSpan × ΔT); zero shifts with tcZero × ΔT and barometric × ΔP', () => {
    const hot = { temperatureDegC: 60, pressureKPa: 101.325 }
    expect(t.output(0.001, hot)).toBeCloseTo(2.0 * 0.001 * (1 + 0.0002 * 40) + 0.0001 * 40, 12)
    const hiP = { temperatureDegC: 20, pressureKPa: 106 }
    expect(t.output(0, hiP)).toBeCloseTo(0.00005 * (106 - 101.325), 12)
  })

  it('thermal hysteresis: after a cycle the zero carries a slow-relaxing residual (user-configurable)', () => {
    const ref = { temperatureDegC: 20, pressureKPa: 101.325 }
    const before = t.output(0.001, ref)
    // excursion to 60 °C: the memory approaches perDegC × 40
    for (let i = 0; i < 20; i++) t.advance(3600, { temperatureDegC: 60 })
    const atHot = t.output(0.001, { temperatureDegC: 60, pressureKPa: 101.325 })
    expect(atHot).toBeGreaterThan(before)
    // back at reference, just after the cycle: the residual is still present
    const justAfter = t.output(0.001, ref)
    expect(justAfter).toBeGreaterThan(before)
    // and it relaxes back over tau
    for (let i = 0; i < 20; i++) t.advance(3600, ref)
    expect(t.output(0.001, ref)).toBeCloseTo(before, 6)
  })

  it('thermalHysteresisPerDegC = 0 is perfectly reversible; a bigger knob reads a bigger difference', () => {
    const zero = new TransductionStage({ ...P, thermalHysteresisPerDegC: 0 })
    const ref = { temperatureDegC: 20, pressureKPa: 101.325 }
    const a = zero.output(0.001, ref)
    for (let i = 0; i < 20; i++) zero.advance(3600, { temperatureDegC: 60 })
    expect(zero.output(0.001, ref)).toBeCloseTo(a, 9)
    const big = new TransductionStage({ ...P, thermalHysteresisPerDegC: 0.0002 })
    const b0 = big.output(0.001, ref)
    for (let i = 0; i < 20; i++) big.advance(3600, { temperatureDegC: 60 })
    expect(big.output(0.001, ref) - b0).toBeGreaterThan(0.0002 * 30)
  })
})
