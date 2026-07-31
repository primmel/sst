import { describe, it, expect } from 'vitest'
import { mulberry32 } from '../rng.js'
import { MechanicalStage } from './mechanical.js'
import { COMPRESSION } from '../families/construction.js'

describe('MechanicalStage (compression profile)', () => {
  it('elastic response is proportional to load and compliance', () => {
    const m = new MechanicalStage(COMPRESSION, mulberry32(1))
    m.setLoad(500)
    expect(m.strainMm).toBeCloseTo(500 * COMPRESSION.complianceKgPerMm, 9)
  })
  it('creep approaches exponentially with tau and recovers on unload', () => {
    const m = new MechanicalStage(COMPRESSION, mulberry32(1))
    m.setLoad(500)
    const s0 = m.strainMm
    m.advance(600) // 10 min
    const crept = m.strainMm - s0
    expect(crept).toBeGreaterThan(0)
    const expect600 = s0 * COMPRESSION.creepCoefficient * (1 - Math.exp(-600 / COMPRESSION.creepTauS))
    expect(crept).toBeCloseTo(expect600, 6)
    m.setLoad(0)
    const afterUnload = m.strainMm
    m.advance(600)
    expect(m.strainMm).toBeLessThan(afterUnload)
  })
  it('hysteresis: the unloading branch reads lower at the same load', () => {
    const m = new MechanicalStage(COMPRESSION, mulberry32(1))
    m.setLoad(500); m.advance(60)
    const loading = m.strainMm
    m.setLoad(250)
    const unloading = m.strainMm
    // unloading branch: strain = elastic(250) × (1 − hysteresisClass) + creep
    const expected = 250 * COMPRESSION.complianceKgPerMm * (1 - COMPRESSION.hysteresisClass)
      + 500 * COMPRESSION.complianceKgPerMm * COMPRESSION.creepCoefficient * (1 - Math.exp(-60 / COMPRESSION.creepTauS))
    expect(unloading).toBeCloseTo(expected, 9)
    expect(unloading).toBeLessThan(loading)
  })
})
