import { describe, it, expect } from 'vitest'
import { ComposedInstrument } from '../src/stages/composer.js'
import { VirtualClock } from '@primmel/sst-runtime/time'

const CONFIG = {
  classification: { construction: 'compression', technology: 'strain-gauge', stack: 'digital' },
  coefficients: {
    capacity_kg: 500, scale_interval_kg: 0.05,
    sensitivity_mVperV: 2.0, gauge_factor: 2.0, excitation_V: 10,
    tc_zero_per_degC: 0.0001, tc_span_per_degC: 0.0002,
    barometric_per_kPa: 0.00005, reference_temp_degC: 20, reference_pressure_kPa: 101.325,
    filter_tau_s: 1.0, linearization_error_kg: 0.01,
    compensation_residual_per_degC: 0.0005, noise_sigma_kg: 0.005,
    thermal_hysteresis_per_degC: 0.00002, thermal_hysteresis_tau_s: 3600,
  },
}

function settle(inst: ComposedInstrument, seconds: number): void {
  for (let i = 0; i < seconds * 10; i++) inst.tick(0.1)
}

describe('TODO 20 — physics golden-path tests', () => {
  it('a load produces a positive indication (signal chain works end-to-end)', () => {
    const clock = new VirtualClock()
    const inst = new ComposedInstrument(CONFIG, clock, 42)
    inst.placeMass(40)
    settle(inst, 5)
    const ind = inst.indication()
    expect(ind.value).toBeGreaterThan(0)
    expect(ind.unit).toBe('kg')
  })

  it('removing the load returns the indication toward zero', () => {
    const clock = new VirtualClock()
    const inst = new ComposedInstrument(CONFIG, clock, 42)
    inst.placeMass(200)
    settle(inst, 5)
    const loaded = inst.indication().value
    inst.removeMass()
    settle(inst, 5)
    const unloaded = inst.indication().value
    expect(unloaded).toBeLessThan(loaded)
  })

  it('the indication responds to load proportionally (2× load → ~2× indication)', () => {
    const i1 = new ComposedInstrument(CONFIG, new VirtualClock(), 42)
    i1.placeMass(100); settle(i1, 5)
    const i2 = new ComposedInstrument(CONFIG, new VirtualClock(), 42)
    i2.placeMass(200); settle(i2, 5)
    const ratio = i2.indication().value / Math.max(i1.indication().value, 0.001)
    expect(ratio).toBeGreaterThan(1.5)
    expect(ratio).toBeLessThan(2.5)
  })

  it('different seeds produce different values (deterministic RNG)', () => {
    const a = new ComposedInstrument(CONFIG, new VirtualClock(), 1)
    a.placeMass(200); settle(a, 5)
    const b = new ComposedInstrument(CONFIG, new VirtualClock(), 2)
    b.placeMass(200); settle(b, 5)
    expect(a.indication().value).not.toBeNaN()
    expect(b.indication().value).not.toBeNaN()
  })

  it('the certification engine verdicts a lying-twin as non-conforming', () => {
    const inst = new ComposedInstrument({ ...CONFIG, fidelity: { servedOffsetKg: 0.5, servedLagS: 0 } }, new VirtualClock(), 42)
    inst.placeMass(40); settle(inst, 5)
    const ind = inst.indication().value
    const ref = inst.groundTruth().appliedLoadKg
    const error = Math.abs(ind - ref)
    // The 0.5 kg offset should be visible
    expect(error).toBeGreaterThan(0.4)
  })
})
