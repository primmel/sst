import { describe, it, expect } from 'vitest'
import { VirtualClock } from './time.js'
import { SimulatedInstrument, LC500_GOOD } from './instrument.js'

/** The user's scenario: cycle the chamber 20 → 60 → 20 °C, put the
 *  same load back on — the indication differs slightly, and the
 *  difference is operator-configurable. */
describe('thermal hysteresis at the instrument level (post-cycle difference)', () => {
  function measure(perDegC: number, tauS = 1800): { before: number; justAfter: number; later: number } {
    const clock = new VirtualClock()
    const def = { ...LC500_GOOD, parameters: { ...LC500_GOOD.parameters, thermalHysteresisPerDegC: perDegC, thermalHysteresisTauS: tauS } }
    const sim = new SimulatedInstrument(def, clock, 42)
    clock.advance(400) // warm up
    // baseline: load, settle the filter for 5 s, read
    sim.setLoad(500); clock.advance(5)
    const before = sim.indication().value
    // unload and let creep recover, THEN cycle the chamber unloaded
    sim.removeLoad(); clock.advance(3600)
    sim.setEnvironment({ temperatureDegC: 60 })
    clock.advance(7200)
    sim.setEnvironment({ temperatureDegC: 20 })
    // the same load back on, same 5 s protocol window — creep cancels
    sim.setLoad(500); clock.advance(5)
    const justAfter = sim.indication().value
    sim.removeLoad(); clock.advance(5 * 3600) // several tau later
    sim.setLoad(500); clock.advance(5)
    const later = sim.indication().value
    return { before, justAfter, later }
  }

  it('the same load reads slightly differently just after a temperature cycle, and relaxes back', () => {
    const { before, justAfter, later } = measure(0.00002)
    const diff = Math.abs(justAfter - before)
    expect(diff).toBeGreaterThan(0)
    expect(diff).toBeLessThan(2) // "minor difference" — well under the MPE class here
    expect(Math.abs(later - before)).toBeLessThanOrEqual(diff + 0.06) // relaxes back toward pre-cycle
  })

  it('the difference scales with the user-configured knob; zero is reversible', () => {
    const small = measure(0.00001)
    const big = measure(0.0001)
    const zero = measure(0)
    expect(Math.abs(big.justAfter - big.before)).toBeGreaterThan(Math.abs(small.justAfter - small.before) * 3)
    expect(Math.abs(zero.justAfter - zero.before)).toBeLessThanOrEqual(0.1) // quantization+noise only
  })

  it('setThermalHysteresis retunes live and never mutates the shared definition record', () => {
    const clock = new VirtualClock()
    const sim = new SimulatedInstrument(LC500_GOOD, clock, 42)
    expect(sim.thermalHysteresis.perDegC).toBe(0.00002)
    sim.setThermalHysteresis(0.0002, 900)
    expect(sim.thermalHysteresis.perDegC).toBe(0.0002)
    expect(sim.thermalHysteresis.tauS).toBe(900)
    expect(LC500_GOOD.parameters.thermalHysteresisPerDegC).toBe(0.00002) // the registry is untouched
    expect(() => sim.setThermalHysteresis(-1, 900)).toThrow(/≥ 0/)
  })
})
