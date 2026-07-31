import { describe, it, expect } from 'vitest'
import { VirtualClock } from './time.js'
import { SimulatedInstrument, LC500_GOOD } from './instrument.js'

describe('SimulatedInstrument (LC-500-class, good-cell)', () => {
  function make() {
    const clock = new VirtualClock()
    const sim = new SimulatedInstrument(LC500_GOOD, clock, 42)
    return { clock, sim }
  }

  it('powers on warming, becomes ready after 5× warm-up tau', () => {
    const { clock, sim } = make()
    expect(sim.operationalState()).toBe('warming')
    clock.advance(LC500_GOOD.parameters.warmUpTauS * 5)
    expect(sim.operationalState()).toBe('ready')
  })

  it('indication of 500 kg is within 0.1 kg of 500 at reference conditions', () => {
    const { clock, sim } = make()
    clock.advance(LC500_GOOD.parameters.warmUpTauS * 5)
    sim.setLoad(500)
    clock.advance(5) // let the filter settle (5 × filterTauS)
    expect(sim.indication().value).toBeCloseTo(500, 1)
    expect(sim.indication().unit).toBe('kg')
  })

  it('span drift accrues with days of virtual time', () => {
    const { clock, sim } = make()
    clock.advance(LC500_GOOD.parameters.warmUpTauS * 5)
    sim.setLoad(500); clock.advance(5)
    const before = sim.indication().value
    clock.advance(86400 * 30) // 30 days
    const after = sim.indication().value
    expect(after).not.toBeCloseTo(before, 3)
    const driftFraction = (after - before) / before
    expect(Math.abs(driftFraction)).toBeGreaterThan(0)
  })

  it('ground truth exposes reality (never the indication)', () => {
    const { clock, sim } = make()
    clock.advance(1)
    sim.setLoad(250)
    const gt = sim.groundTruth()
    expect(gt.appliedLoadKg).toBe(250)
    expect(gt.strainMm).toBeGreaterThan(0)
    expect(gt.clockS).toBe(clock.now())
  })

  it('reset returns to zero and re-warms', () => {
    const { clock, sim } = make()
    clock.advance(LC500_GOOD.parameters.warmUpTauS * 5)
    sim.setLoad(500); clock.advance(5)
    sim.reset()
    expect(sim.operationalState()).toBe('warming')
    expect(sim.groundTruth().appliedLoadKg).toBe(0)
  })
})
