import { describe, it, expect } from 'vitest'
import { VirtualClock } from './time.js'
import { SimulatedGasAnalyzer } from './gas-instrument.js'
import { GAS_SCENARIOS, getGasScenario, validateGasScenario } from './gas-scenario.js'

describe('gas scenario registry (spec §8 idiom — presets are data)', () => {
  it('ships the four presets', () => {
    for (const name of ['good-analyzer', 'drifting-analyzer', 'span-shifted', 'contaminated-optics']) {
      expect(GAS_SCENARIOS[name], name).toBeDefined()
    }
  })
  it('getGasScenario throws with the known names on a miss', () => {
    expect(() => getGasScenario('nope')).toThrow(/good-analyzer/)
  })
  it('drifting-analyzer drifts an order of magnitude harder than good-analyzer', () => {
    const good = getGasScenario('good-analyzer').channels[0]!.conditioning
    const drift = getGasScenario('drifting-analyzer').channels[0]!.conditioning
    expect(drift.zeroDriftPpmPerDay).toBeGreaterThanOrEqual(5 * good.zeroDriftPpmPerDay)
    expect(drift.spanDriftPerDay).toBeGreaterThanOrEqual(5 * good.spanDriftPerDay)
  })
  it('contaminated-optics boots with the fault physically present (ground truth)', () => {
    const clock = new VirtualClock()
    const sim = new SimulatedGasAnalyzer(getGasScenario('contaminated-optics'), clock, 1)
    expect(sim.groundTruth().channels.co.contamination).toBeCloseTo(0.1, 9)
    clock.advance(3600 + 300)
    expect(sim.indication('co').value).toBeGreaterThan(20) // the false zero reading, through the stages
  })
})

describe('the drift classes at the R 144 horizons (4.8: error ≤ MPE for 7 days)', () => {
  const MPE = (x: number) => Math.max(2, 0.05 * Math.abs(x))
  function driftErrorAt(scenario: string, days: number): number {
    const clock = new VirtualClock()
    const sim = new SimulatedGasAnalyzer(getGasScenario(scenario), clock, 42)
    clock.advance(3600)
    sim.setGasConcentration('co', 100) // the smallest CGM point (10 % of range)
    clock.advance(300)
    const day0 = sim.indication('co').value
    clock.advance(days * 86400)
    return Math.abs(sim.indication('co').value - day0)
  }
  it('good-analyzer stays inside MPE at 24 h AND 7 days', () => {
    expect(driftErrorAt('good-analyzer', 1)).toBeLessThan(MPE(100))
    expect(driftErrorAt('good-analyzer', 7)).toBeLessThan(MPE(100))
  })
  it('drifting-analyzer passes 24 h but FAILS the 7-day horizon', () => {
    expect(driftErrorAt('drifting-analyzer', 1)).toBeLessThan(MPE(100))
    expect(driftErrorAt('drifting-analyzer', 7)).toBeGreaterThan(MPE(100))
  })
})

describe('validateGasScenario (authored definitions are data)', () => {
  it('rejects with precise field errors', () => {
    expect(() => validateGasScenario({})).toThrow(/id/)
    expect(() => validateGasScenario(validRecord({ channels: [] }))).toThrow(/channels/)
    expect(() => validateGasScenario(validRecord({ parameters: {} }))).toThrow(/warmUpTauS/)
    const badPrinciple = validRecord({})
    ;(badPrinciple.channels as Array<Record<string, unknown>>)[0]!.transduction = { principle: 'fid' }
    expect(() => validateGasScenario(badPrinciple)).toThrow(/principle/)
    const badCond = validRecord({})
    ;(badCond.channels as Array<Record<string, unknown>>)[0]!.conditioning = {}
    expect(() => validateGasScenario(badCond)).toThrow(/rangePpm/)
  })
  it('a JSON-authored definition record validates', () => {
    const s = validateGasScenario(validRecord({}))
    expect(s.name).toBe('json-analyzer')
  })
})

function validRecord(over: Record<string, unknown>): Record<string, unknown> {
  const good = getGasScenario('good-analyzer')
  return {
    id: 'json-analyzer', name: 'json-analyzer', description: 'authored as data',
    channels: structuredClone(good.channels), parameters: { ...good.parameters },
    ...over,
  }
}
