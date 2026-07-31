import { describe, it, expect } from 'vitest'
import { SCENARIOS, getScenario, validateScenario } from './scenario.js'

describe('scenario registry (spec §8)', () => {
  it('ships the four presets', () => {
    for (const name of ['good-cell', 'creep-cell', 'temp-cell', 'drift-cell']) {
      expect(SCENARIOS[name], name).toBeDefined()
    }
  })
  it('creep-cell creeps ≥10× harder than good-cell', () => {
    const good = getScenario('good-cell')
    const creep = getScenario('creep-cell')
    const goodCreep = (typeof good.construction === 'string' ? 0.0003 : good.construction.creepCoefficient)
    const badCreep = (typeof creep.construction === 'string' ? 0.0003 : creep.construction.creepCoefficient)
    expect(badCreep).toBeGreaterThanOrEqual(10 * goodCreep)
  })
  it('getScenario throws with the known names on a miss', () => {
    expect(() => getScenario('nope')).toThrow(/good-cell/)
  })
  it('validateScenario rejects with precise field errors', () => {
    expect(() => validateScenario({})).toThrow(/id/)
    expect(() => validateScenario(validRecord({ parameters: {} }))).toThrow(/capacityKg/)
    expect(() => validateScenario(validRecord({ stack: 'holographic' }))).toThrow(/stack/)
  })
  it('a JSON-authored definition record validates', () => {
    const s = validateScenario(validRecord({}))
    expect(s.name).toBe('json-cell')
  })
})

function validRecord(over: Record<string, unknown>): Record<string, unknown> {
  return {
    id: 'json-cell', name: 'json-cell', description: 'authored as data',
    construction: {
      id: 'compression', complianceKgPerMm: 2.0e-6, hysteresisClass: 0.0005,
      creepCoefficient: 0.0003, creepTauS: 300, resonantHz: 180, offCenterSensitivity: 0.0002,
    },
    stack: 'digital',
    parameters: {
      capacityKg: 500, scaleIntervalKg: 0.05, sensitivityMVperV: 2.0, gaugeFactor: 2.0, excitationV: 10,
      tcZeroPerDegC: 0.0001, tcSpanPerDegC: 0.0002, barometricPerKPa: 0.00005,
      referenceTempDegC: 20, referencePressureKPa: 101.325,
      thermalHysteresisPerDegC: 0.00002, thermalHysteresisTauS: 3600,
      filterTauS: 1.0, linearizationErrorKg: 0.01, compensationResidualPerDegC: 0.0005,
      noiseSigmaKg: 0.005, warmUpTauS: 60, spanDriftPerDay: 0.000005,
    },
    ...over,
  }
}
