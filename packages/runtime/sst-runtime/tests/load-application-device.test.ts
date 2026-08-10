// physics/devices/load-application-device.test.ts — the load application
// device's ramp, realization error, and integration with the composed
// instrument (R 60-2, 2.7.2: the force-generating system; 2.7.3.3: loads
// applied axially and without shock).

import { describe, it, expect } from 'vitest'
import { LoadApplicationDevice } from '../src/physics/devices/load-application-device.js'
import { ComposedInstrument } from '../src/stages/composer.js'
import { VirtualClock } from '../src/time.js'
import { mulberry32 } from '../src/physics/rng.js'

const SPEC = {
  capacityKg: 3000,
  classFraction: 0.0005,          // ISO 376 class 0.5 analog (±0.05 %)
  repeatabilityFraction: 0.0002,  // 0.02 %
  defaultRateKgPerS: 100,
}

function device(seed = 42) {
  return new LoadApplicationDevice(SPEC, mulberry32(seed))
}

describe('LoadApplicationDevice', () => {
  it('ramps toward the nominal target at the declared rate (no shock)', () => {
    const d = device()
    d.apply(500, 100)
    expect(d.state().phase).toBe('applying')
    d.advance(1)
    expect(d.state().nominalKg).toBe(100)
    d.advance(3)
    expect(d.state().nominalKg).toBe(400)
    d.advance(2) // would overshoot — clamps at the target
    expect(d.state().nominalKg).toBe(500)
    expect(d.state().phase).toBe('holding')
  })

  it('realizes the target within the machine class bound, never exactly', () => {
    const d = device()
    d.apply(1000, 1000)
    d.advance(1)
    const s = d.state()
    // actual = target × (1 + ε_cal) + ε_rep with |ε_cal| ≤ classFraction
    const bound = 1000 * SPEC.classFraction + 5 * 1000 * SPEC.repeatabilityFraction
    expect(Math.abs(s.actualKg - 1000)).toBeLessThanOrEqual(bound)
    expect(Math.abs(s.calErrorFraction)).toBeLessThanOrEqual(SPEC.classFraction)
  })

  it('keeps the systematic error constant across applications (calibration state)', () => {
    const d = device()
    d.apply(100, 100)
    d.advance(1)
    const first = d.state().calErrorFraction
    d.release(100)
    d.advance(1)
    d.apply(200, 200)
    d.advance(1)
    expect(d.state().calErrorFraction).toBe(first)
    d.recalibrate()
    // After recalibration the state is re-drawn (within the same bound).
    expect(Math.abs(d.state().calErrorFraction)).toBeLessThanOrEqual(SPEC.classFraction)
  })

  it('releases back to the dead load', () => {
    const d = device()
    d.apply(500, 250)
    d.advance(2)
    d.release(250)
    d.advance(2)
    expect(d.state().nominalKg).toBe(0)
    expect(d.state().phase).toBe('idle')
    expect(d.actualKg()).toBe(0)
  })

  it('refuses a target beyond the machine capacity', () => {
    const d = device()
    expect(() => d.apply(4000)).toThrow('exceeds the machine')
  })

  it('is deterministic per harness seed', () => {
    const a = device(7)
    const b = device(7)
    a.apply(500, 500)
    b.apply(500, 500)
    a.advance(1)
    b.advance(1)
    expect(a.actualKg()).toBe(b.actualKg())
  })
})

describe('ComposedInstrument × load application device', () => {
  function instrument() {
    const clock = new VirtualClock()
    const inst = new ComposedInstrument({
      classification: { construction: 'column', technology: 'strain-gauge', stack: 'digital' },
      coefficients: { capacity_kg: 500, lad_capacity_kg: 3000 },
    }, clock, 1)
    return { clock, inst }
  }

  it('declares the device from the instance coefficients at boot', () => {
    const { inst } = instrument()
    const s = inst.ladState()
    expect(s).not.toBeNull()
    expect(s!.capacityKg).toBe(3000)
    expect(s!.engaged).toBe(false)
  })

  it('drives the applied load through the ramp on clock advances', () => {
    const { clock, inst } = instrument()
    inst.ladApply(500, 100)
    clock.advance(1)
    expect(inst.groundTruth().appliedLoadKg).toBeGreaterThan(90)
    expect(inst.groundTruth().appliedLoadKg).toBeLessThan(110)
    clock.advance(10) // settles at the realized load
    const settled = inst.groundTruth().appliedLoadKg
    expect(settled).toBeGreaterThan(499)
    expect(settled).toBeLessThan(501)
    expect(inst.groundTruth().lad!.phase).toBe('holding')
    // The indication follows the machine's REALIZED load.
    expect(inst.indication().value).toBeGreaterThan(490)
    expect(inst.indication().value).toBeLessThan(510)
  })

  it('releases through the ramp and the indication returns toward zero', () => {
    const { clock, inst } = instrument()
    inst.ladApply(500, 500)
    clock.advance(1)
    inst.ladRelease(500)
    clock.advance(1)
    expect(inst.groundTruth().appliedLoadKg).toBeLessThan(1)
  })

  it('placeMass disengages the device (the direct deadweight path)', () => {
    const { clock, inst } = instrument()
    inst.ladApply(500, 500)
    clock.advance(1)
    inst.placeMass(123)
    expect(inst.ladState()!.engaged).toBe(false)
    expect(inst.groundTruth().appliedLoadKg).toBe(123)
  })

  it('boots without a device when the instance declares none', () => {
    const clock = new VirtualClock()
    const inst = new ComposedInstrument({
      classification: { construction: 'column', technology: 'strain-gauge', stack: 'digital' },
      coefficients: { capacity_kg: 500 },
    }, clock, 1)
    expect(inst.ladState()).toBeNull()
    expect(inst.groundTruth().lad).toBeNull()
  })
})
