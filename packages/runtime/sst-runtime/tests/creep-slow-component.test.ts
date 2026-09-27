// tests/creep-slow-component.test.ts — the mechanical stage's secondary
// (slow) creep law. The failing creep cell's signature: the primary
// component saturates within minutes while the slow tail keeps the
// indication walking through the R 60-1 §5.5.1 20–30 minute band the
// evaluation judges. Without the slow pair the law is the legacy single
// exponential, byte-identical.

import { describe, it, expect } from 'vitest'
import { mulberry32 } from '../src/physics/rng.js'
import { MechanicalStage } from '../src/physics/stages/mechanical.js'
import { COMPRESSION } from '../src/physics/families/construction.js'

describe('MechanicalStage — the secondary (slow) creep component', () => {
  it('follows the same exponential law with its own τ, summed with the primary', () => {
    const profile = { ...COMPRESSION, creepSlowCoefficient: 0.002, creepSlowTauS: 2400 }
    const m = new MechanicalStage(profile, mulberry32(1))
    m.setLoad(500)
    const s0 = m.strainMm
    const elastic = 500 * COMPRESSION.complianceKgPerMm
    const curve = (tS: number) =>
      elastic * profile.creepCoefficient * (1 - Math.exp(-tS / profile.creepTauS))
      + elastic * 0.002 * (1 - Math.exp(-tS / 2400))

    m.advance(1200) // t = 20 min
    const at20 = m.strainMm - s0
    m.advance(600) // t = 30 min
    const at30 = m.strainMm - s0
    expect(at20).toBeCloseTo(curve(1200), 9)
    expect(at30).toBeCloseTo(curve(1800), 9)

    // The band drift is the slow tail's: the primary (τ = 300 s) is
    // saturated by t20, so t30 − t20 ≈ the slow component's rise alone.
    const band = at30 - at20
    expect(band).toBeCloseTo(elastic * 0.002 * (Math.exp(-1200 / 2400) - Math.exp(-1800 / 2400)), 6)
    expect(band).toBeGreaterThan(0)

    // creepMm reads back the sum of both states; unload decays both.
    expect(m.creepMm).toBeCloseTo(at30, 9)
    m.setLoad(0)
    const unloaded = m.creepMm
    m.advance(600)
    expect(m.creepMm).toBeLessThan(unloaded)
  })

  it('a profile without the slow pair keeps the single-component law', () => {
    const m = new MechanicalStage(COMPRESSION, mulberry32(1))
    m.setLoad(500)
    const s0 = m.strainMm
    m.advance(1800)
    const expected = s0 * COMPRESSION.creepCoefficient * (1 - Math.exp(-1800 / COMPRESSION.creepTauS))
    expect(m.strainMm - s0).toBeCloseTo(expected, 9)
    expect(m.creepMm).toBeCloseTo(m.strainMm - 500 * COMPRESSION.complianceKgPerMm, 9)
  })
})
