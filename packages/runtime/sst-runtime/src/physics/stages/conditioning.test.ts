import { describe, it, expect } from 'vitest'
import { mulberry32, normal } from '../rng.js'
import { ConditioningStage, type ConditioningParams } from './conditioning.js'

const base: ConditioningParams = {
  stack: 'digital', scaleIntervalKg: 0.05, capacityKg: 500,
  filterTauS: 1.0, linearizationErrorKg: 0.01, compensationResidualPerDegC: 0.0005, noiseSigmaKg: 0.005,
}

describe('ConditioningStage (digital stack)', () => {
  it('quantizes to the scale interval', () => {
    const c = new ConditioningStage(base, normal(mulberry32(7)))
    const out = c.process(1.23456, 0.001, { temperatureDegC: 20 })
    expect(out.indicationKg * 1000 % (base.scaleIntervalKg * 1000)).toBeCloseTo(0, 6)
  })
  it('first-order filter lags a step, then settles', () => {
    const c = new ConditioningStage(base, normal(mulberry32(7)))
    c.process(2.0, 0.001, { temperatureDegC: 20 })
    const early = c.process(0.0, 0.1, { temperatureDegC: 20 }).indicationKg
    for (let i = 0; i < 100; i++) c.process(0.0, 0.1, { temperatureDegC: 20 })
    const settled = c.process(0.0, 0.1, { temperatureDegC: 20 }).indicationKg
    expect(Math.abs(settled)).toBeLessThanOrEqual(Math.abs(early))
  })
  it('analog-passive passes the bridge through (no quantization)', () => {
    const c = new ConditioningStage({ ...base, stack: 'analog-passive' }, normal(mulberry32(7)))
    const out = c.process(1.23456, 0.001, { temperatureDegC: 20 })
    expect(out.indicationKg).not.toBeNaN()
    expect(out.indicationKg).toBeCloseTo(1.23456 * 250, 9)
  })
})
