import { describe, it, expect } from 'vitest'
import { UncertaintyBudget } from '../src/certification/uncertainty.js'
import { checkFreshness, enforceFreshnessOrThrow } from '../src/twin/freshness-check.js'
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

describe('TODO 26 — instrument-legal operations', () => {
  it('zeroSetting captures the current indication as zero reference', () => {
    const inst = new ComposedInstrument(CONFIG, new VirtualClock(), 1)
    inst.placeMass(40)
    for (let i = 0; i < 50; i++) inst.tick(0.1)
    const before = inst.indication().value
    inst.zeroSetting()
    // After zero-setting, the indication should shift by the captured zero
    inst.tick(0.1)
    const after = inst.indication().value
    expect(after).not.toBe(before)  // the zero offset changed the reading
  })

  it('runSelfTest returns pass for a healthy instrument', () => {
    const inst = new ComposedInstrument(CONFIG, new VirtualClock(), 1)
    inst.placeMass(40)
    inst.tick(1.0)
    expect(inst.runSelfTest()).toBe('pass')
  })

  it('runSelfTest returns fail for a faulted instrument', () => {
    const inst = new ComposedInstrument(CONFIG, new VirtualClock(), 1)
    inst.injectFault()
    expect(inst.runSelfTest()).toBe('fail')
  })
})

describe('TODO 28 — measurement uncertainty budget (GUM)', () => {
  it('computes Type A uncertainty from repeated readings', () => {
    const budget = new UncertaintyBudget()
    // Simulate 20 readings around 40.00 kg with σ=0.01
    for (let i = 0; i < 20; i++) {
      budget.recordIndication(40.00 + (Math.random() - 0.5) * 0.02)
    }
    const typeA = budget.typeAUncertainty()
    expect(typeA).toBeGreaterThan(0)
    expect(typeA).toBeLessThan(0.01)  // σ/√n < σ
  })

  it('combines Type A + Type B into combined uncertainty', () => {
    const budget = new UncertaintyBudget()
    budget.recordIndication(40.00)
    budget.recordIndication(40.01)
    budget.addComponent('resolution', 0.025, 'scale interval d=0.05 kg, u=d/(2√3)')
    budget.addComponent('linearity', 0.01, 'manufacturer spec')
    const combined = budget.combinedUncertainty()
    expect(combined).toBeGreaterThan(0.025)  // larger than the largest component
  })

  it('expands by k=2 for 95% confidence', () => {
    const budget = new UncertaintyBudget()
    budget.addComponent('resolution', 0.025, 'd=0.05 kg')
    const expanded = budget.expandedUncertainty(2)
    expect(expanded).toBeCloseTo(0.05, 1)  // 2 × 0.025
  })

  it('produces a full report with all components', () => {
    const budget = new UncertaintyBudget()
    for (let i = 0; i < 10; i++) budget.recordIndication(40 + Math.random() * 0.01)
    budget.addComponent('calibration', 0.02, 'last cal certificate')
    const report = budget.report()
    expect(report.typeA.n).toBe(10)
    expect(report.typeB.length).toBe(1)
    expect(report.combined).toBeGreaterThan(0)
    expect(report.expanded).toBeGreaterThan(report.combined)
    expect(report.k).toBe(2)
  })
})

describe('TODO 30 — twin-freshness enforcement', () => {
  it('returns fresh for a value within the window', () => {
    const result = checkFreshness({ servedAt: 100, freshWithinS: 5, nowS: 102 })
    expect(result.verdict).toBe('fresh')
    expect(result.ageS).toBe(2)
  })

  it('returns stale for a value past the window but under 2×', () => {
    const result = checkFreshness({ servedAt: 100, freshWithinS: 5, nowS: 108 })
    expect(result.verdict).toBe('stale')
    expect(result.ageMultiplier).toBeGreaterThan(1)
  })

  it('returns expired for a value past 2× the window', () => {
    const result = checkFreshness({ servedAt: 100, freshWithinS: 5, nowS: 115 })
    expect(result.verdict).toBe('expired')
    expect(result.ageMultiplier).toBeGreaterThan(2)
  })

  it('throws on expired values (strict mode)', () => {
    expect(() => enforceFreshnessOrThrow({ servedAt: 100, freshWithinS: 5, nowS: 120 }))
      .toThrow(/freshness violation/)
  })

  it('does not throw on fresh values', () => {
    expect(() => enforceFreshnessOrThrow({ servedAt: 100, freshWithinS: 5, nowS: 101 }))
      .not.toThrow()
  })
})
