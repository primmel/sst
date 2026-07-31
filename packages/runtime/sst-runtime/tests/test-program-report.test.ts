import { describe, it, expect } from 'vitest'
import { executeTestProgram, R60_CREEP_TEST, R60_REPEATABILITY_TEST } from '../src/certification/test-program.js'
import { CertificationEngine, type MpeConfig } from '../src/certification/verdict.js'
import { UncertaintyBudget } from '../src/certification/uncertainty.js'
import { formatR602Report } from '../src/certification/r602-report.js'
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

const MPE_CONFIG: MpeConfig = {
  vMin: 500 / 6000, pLc: 0.7,
  classes: { C: { bands: [{ intervals: [0, 500], factor: 0.5 }] } },
}

describe('TODO 27 — test-program executor', () => {
  it('executes the R 60-2 creep test (7 probes over 35 min)', () => {
    const clock = new VirtualClock()
    const inst = new ComposedInstrument(CONFIG, clock, 1)
    const eng = new CertificationEngine('test', 'C', MPE_CONFIG)

    const probes = executeTestProgram(R60_CREEP_TEST, inst, clock, eng)
    expect(probes.length).toBe(7)
    expect(probes[0]!.loadKg).toBe(500)  // applied E_max
    // The first probe's verdict should be defined
    expect(probes[0]!.verdict).toMatch(/^(conforming|non-conforming)$/)
  })

  it('executes the repeatability test (6 probes)', () => {
    const clock = new VirtualClock()
    const inst = new ComposedInstrument(CONFIG, clock, 1)
    const eng = new CertificationEngine('test', 'C', MPE_CONFIG)

    const probes = executeTestProgram(R60_REPEATABILITY_TEST, inst, clock, eng)
    expect(probes.length).toBe(6)
    expect(probes[0]!.loadKg).toBe(100)
  })
})

describe('TODO 31 — OIML R 60-2 test report format', () => {
  it('formats a TestReport into the R 60-2 report shape', () => {
    const clock = new VirtualClock()
    const inst = new ComposedInstrument(CONFIG, clock, 1)
    const eng = new CertificationEngine('lc500-001', 'C', MPE_CONFIG)

    const probes = executeTestProgram(R60_REPEATABILITY_TEST, inst, clock, eng)
    const report = eng.report(probes)

    const budget = new UncertaintyBudget()
    budget.addComponent('resolution', 0.014, 'd=0.05 kg')
    const uncertaintyReport = budget.report()

    const r602 = formatR602Report(report, uncertaintyReport, {
      reportNumber: 'R60/2024-SST-001',
      manufacturer: 'ACME Instruments',
      model: 'LC-500',
      serial: 'LC500-001',
      designation: 'LC-500 class C6',
      nLc: 6000,
      eMaxKg: 500,
      eMinKg: 10,
      dKg: 0.05,
      vMinKg: 0.0833,
      tempRange: '-10 … +40 °C',
      technology: 'strain-gauge',
    })

    expect(r602.report_header.report_number).toBe('R60/2024-SST-001')
    expect(r602.report_header.recommendation).toBe('oiml-r60')
    expect(r602.instrument_identification.accuracy_class).toBe('C')
    expect(r602.instrument_identification.n_lc).toBe(6000)
    expect(r602.test_results[0]!.probes.length).toBe(6)
    expect(r602.uncertainty).not.toBeNull()
    expect(r602.uncertainty!.expanded_u_k2).toBeGreaterThan(0)
    expect(r602.overall_verdict).toMatch(/^(pass|fail)$/)
  })

  it('formats without an uncertainty budget (null is OK)', () => {
    const eng = new CertificationEngine('test', 'C', MPE_CONFIG)
    const report = eng.report([eng.probe(0, 40, 40.01)])
    const r602 = formatR602Report(report, null, {
      reportNumber: 'R60/2024-SST-002',
      manufacturer: 'ACME', model: 'LC-500', serial: '002',
      designation: 'LC-500', nLc: 6000, eMaxKg: 500, eMinKg: 10,
      dKg: 0.05, vMinKg: 0.083, tempRange: '-10…+40', technology: 'strain-gauge',
    })
    expect(r602.uncertainty).toBeNull()
    expect(r602.overall_verdict).toBe('pass')
  })
})
