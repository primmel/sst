import { describe, it, expect } from 'vitest'
import { VirtualClock } from './time.js'
import { SimulatedInstrument } from './instrument.js'
import { getScenario } from './scenario.js'

function boot(scenarioName: string) {
  const clock = new VirtualClock()
  const def = getScenario(scenarioName)
  const sim = new SimulatedInstrument(def, clock, 7)
  clock.advance(def.parameters.warmUpTauS * 5)
  sim.setLoad(500)
  clock.advance(5)
  return { clock, sim, def }
}

describe('fidelity knobs (spec §8.1 — the twin-certification groundwork)', () => {
  it('good-cell: served equals truth, servedAt is now', () => {
    const { clock, sim } = boot('good-cell')
    expect(sim.indication().value).toBeCloseTo(500, 1)
    expect(sim.servedAt()).toBe(clock.now())
  })
  it('lying-twin: served diverges from the true indication by exactly the offset', () => {
    const { sim } = boot('lying-twin')
    const served = sim.indication().value
    // truth: the same physics without the offset (good-cell twin)
    const { sim: honest } = boot('good-cell')
    const truth = honest.indication().value
    expect(served - truth).toBeCloseTo(getScenario('lying-twin').fidelity!.servedOffsetKg, 9)
    // ground truth never carries the offset (the epistemic wall)
    expect(sim.groundTruth().appliedLoadKg).toBe(500)
  })
  it('stale-twin: servedAt lags the clock by the declared lag', () => {
    const { clock, sim } = boot('stale-twin')
    expect(clock.now() - sim.servedAt()).toBeCloseTo(getScenario('stale-twin').fidelity!.servedLagS, 9)
  })
  it('setFidelity is a /world operation: scenario defaults are {0,0} for honest cells', () => {
    const { sim } = boot('good-cell')
    sim.setFidelity({ servedOffsetKg: 0.25, servedLagS: 10 })
    const moved = sim.indication().value
    sim.setFidelity({ servedOffsetKg: 0, servedLagS: 0 })
    expect(Math.abs(moved - sim.indication().value)).toBeCloseTo(0.25, 9)
  })
})
