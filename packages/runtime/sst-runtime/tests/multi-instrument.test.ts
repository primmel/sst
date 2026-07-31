import { describe, it, expect } from 'vitest'
import { MultiSession } from '../src/session/multi-session.js'
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

describe('TODO 21 — multi-instrument scenarios', () => {
  it('runs two instruments sharing a clock + environment', () => {
    const clock = new VirtualClock()
    const instA = new ComposedInstrument(CONFIG, clock, 1)
    const instB = new ComposedInstrument(CONFIG, clock, 2)

    const multi = new MultiSession('good-cell', instA, 'test-cell', instB, clock)

    // Place the same load on both
    multi.placeMass(200)
    multi.tick(1.0)

    // Both should produce valid indications
    expect(instA.indication().value).not.toBeNaN()
    expect(instB.indication().value).not.toBeNaN()
  })

  it('a lying-twin diverges from a good-cell under the same load', () => {
    const clock = new VirtualClock()
    const goodConfig = CONFIG
    const lyingConfig = { ...CONFIG, fidelity: { servedOffsetKg: 0.5, servedLagS: 0 } }

    const instA = new ComposedInstrument(goodConfig, clock, 1)
    const instB = new ComposedInstrument(lyingConfig, clock, 2)
    const multi = new MultiSession('good-cell', instA, 'lying-twin', instB, clock)

    // Place load and settle
    multi.placeMass(200)
    for (let i = 0; i < 50; i++) multi.tick(0.1)

    // Probe: the divergence should be ~0.5 kg (the fidelity offset)
    const probe = multi.probe(clock.now())
    expect(probe.divergenceKg).toBeGreaterThan(0.3)  // ~0.5 kg offset visible
  })

  it('compiles a comparison report with max + avg divergence', () => {
    const clock = new VirtualClock()
    const instA = new ComposedInstrument(CONFIG, clock, 1)
    const instB = new ComposedInstrument({ ...CONFIG, fidelity: { servedOffsetKg: 1.0, servedLagS: 0 } }, clock, 2)
    const multi = new MultiSession('reference', instA, 'dut', instB, clock)

    // Probe at several loads
    const probes: Array<ReturnType<typeof multi.probe>> = []
    for (const load of [40, 100, 200, 400]) {
      multi.placeMass(load)
      for (let i = 0; i < 50; i++) multi.tick(0.1)
      probes.push(multi.probe(clock.now()))
    }

    const report = multi.compare(probes)
    expect(report.instrumentA).toBe('reference')
    expect(report.instrumentB).toBe('dut')
    expect(report.sharedClock).toBe(true)
    expect(report.maxDivergenceKg).toBeGreaterThan(0.5)  // 1.0 kg offset
    expect(report.avgDivergenceKg).toBeGreaterThan(0.5)
    expect(report.probes).toHaveLength(4)
  })

  it('shares environment changes between both instruments', () => {
    const clock = new VirtualClock()
    const instA = new ComposedInstrument(CONFIG, clock, 1)
    const instB = new ComposedInstrument(CONFIG, clock, 2)
    const multi = new MultiSession('a', instA, 'b', instB, clock)

    multi.setEnvironment({ temperatureDegC: 60 })

    // Both should see the same temperature
    expect(instA.environment().temperatureDegC).toBe(60)
    expect(instB.environment().temperatureDegC).toBe(60)
  })
})
