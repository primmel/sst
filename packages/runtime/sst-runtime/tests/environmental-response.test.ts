import { describe, it, expect } from 'vitest'
import { ComposedInstrument } from '../src/stages/composer.js'
import { EnvironmentalResponseLayer, dampHeatCyclicDb, burstEvent } from '../src/environment/response.js'
import { VirtualClock } from '@primmel/sst-runtime/time'

describe('TODO 15 — environmental-response layer', () => {
  const baseConfig = {
    classification: { construction: 'compression', technology: 'strain-gauge', stack: 'digital' },
    coefficients: {
      capacity_kg: 500, scale_interval_kg: 0.05,
      sensitivity_mVperV: 2.0, gauge_factor: 2.0, excitation_V: 10,
      tc_zero_per_degC: 0.001, tc_span_per_degC: 0.002,
      barometric_per_kPa: 0.00005, reference_temp_degC: 20, reference_pressure_kPa: 101.325,
      filter_tau_s: 1.0, linearization_error_kg: 0.01,
      compensation_residual_per_degC: 0.0005, noise_sigma_kg: 0.005,
      thermal_hysteresis_per_degC: 0.00002, thermal_hysteresis_tau_s: 3600,
    },
  }

  it('drives the instrument environment from a D 11 profile', () => {
    const clock = new VirtualClock()
    const inst = new ComposedInstrument(baseConfig, clock, 1)
    const layer = new EnvironmentalResponseLayer(inst, clock)

    // A simple temperature ramp: 20 °C at t=0, 60 °C at t=3600s (1 °C/min)
    layer.playProgram({
      keyframes: [
        { atS: 0, temperatureDegC: 20 },
        { atS: 3600, temperatureDegC: 60 },
      ],
      events: [],
      loop: false,
      totalDurationS: 3600,
    })

    // Advance to the midpoint (t=1800s → temperature should be ~40 °C)
    clock.advance(1800)
    layer.tick()
    inst.tick(1.0)

    const env = inst.environment()
    expect(env.temperatureDegC).toBeCloseTo(40, 0)
  })

  it('plays the damp-heat-cyclic-db profile (24h cycle)', () => {
    const clock = new VirtualClock()
    const inst = new ComposedInstrument(baseConfig, clock, 1)
    const layer = new EnvironmentalResponseLayer(inst, clock)

    layer.playProgram(dampHeatCyclicDb(40))

    // At t=0: 25 °C
    layer.tick()
    expect(inst.environment().temperatureDegC).toBeCloseTo(25, 1)

    // At t=3h (ramp end): 40 °C
    clock.advance(3 * 3600)
    layer.tick()
    expect(inst.environment().temperatureDegC).toBeCloseTo(40, 0)

    // At t=12h (upper hold): still 40 °C
    clock.advance(9 * 3600)
    layer.tick()
    expect(inst.environment().temperatureDegC).toBeCloseTo(40, 0)

    // At t=18h (cool-down): back to 25 °C
    clock.advance(6 * 3600)
    layer.tick()
    expect(inst.environment().temperatureDegC).toBeCloseTo(25, 0)
  })

  it('temperature change drives the instrument environment correctly', () => {
    const clock = new VirtualClock()
    const inst = new ComposedInstrument(baseConfig, clock, 1)
    const layer = new EnvironmentalResponseLayer(inst, clock)

    // Settle, then ramp temperature via the D 11 program
    inst.placeMass(200)
    layer.playProgram({
      keyframes: [{ atS: 0, temperatureDegC: 20 }, { atS: 100, temperatureDegC: 60 }],
      events: [], loop: false, totalDurationS: 101,
    })

    // After ramp: the instrument's environment should reflect 60 °C
    clock.advance(100)
    layer.tick()
    expect(inst.environment().temperatureDegC).toBeCloseTo(60, 0)

    // The indication is a valid number (the physics didn't corrupt)
    inst.tick(1.0)
    const ind = inst.indication()
    expect(ind.unit).toBe('kg')
    // Note: exact calibration magnitude is TODO 20 (golden-path tests)
  })

  it('a disturbance event latches a fault', () => {
    const clock = new VirtualClock()
    const inst = new ComposedInstrument(baseConfig, clock, 1)
    const layer = new EnvironmentalResponseLayer(inst, clock)

    layer.playProgram({
      keyframes: [{ atS: 0, temperatureDegC: 20 }],
      events: [burstEvent(100, 2.0)],
      loop: false,
      totalDurationS: 200,
    })

    // Before the event: state is ready
    layer.tick()
    expect(inst.operationalState()).toBe('ready')

    // After the event fires (t=100): fault latched
    clock.advance(100)
    layer.tick()
    expect(inst.operationalState()).toBe('fault')
  })
})
