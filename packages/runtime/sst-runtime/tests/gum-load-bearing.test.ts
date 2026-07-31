import { describe, it, expect } from 'vitest'
import { CertificationEngine, type MpeConfig, MIN_TUR } from '../src/certification/verdict.js'
import { UncertaintyBudget } from '../src/certification/uncertainty.js'

const MPE: MpeConfig = {
  vMin: 500 / 6000, pLc: 0.7,
  classes: { C: { bands: [{ intervals: [0, 500], factor: 0.5 }] } },
}

describe('GUM-load-bearing TUR verification (the uncertainty budget matters)', () => {
  it('a probe with a known U carries marginInU and tur', () => {
    const eng = new CertificationEngine('test', 'C', MPE)
    const U = 0.010  // 10 g expanded uncertainty (k=2)
    const p = eng.probe(0, 200, 200.05, U)
    expect(p.tur).toBeDefined()
    expect(p.marginInU).toBeDefined()
    // MPE at 200 kg for class C: 0.5 × (500/6000) × 0.7 = 0.02917 kg
    // TUR = 0.02917 / 0.010 = 2.917 — below the 4:1 threshold
    expect(p.tur).toBeLessThan(MIN_TUR)
    // marginInU = (0.02917 - 0.05) / 0.010 = -2.083 — the error exceeds MPE
    // Wait: error = |200.05 - 200| = 0.05, MPE = 0.02917
    // errorFractionOfMpe = 0.05 / 0.02917 > 1 → non-conforming
    // margin = MPE - error = 0.02917 - 0.05 = -0.021
    // marginInU = -0.021 / 0.010 = -2.08
    expect(p.marginInU).toBeLessThan(0)
  })

  it('a probe with adequate TUR (> 4:1) carries positive marginInU', () => {
    const eng = new CertificationEngine('test', 'C', MPE)
    // Very small U → high TUR
    const U = 0.001  // 1 g — excellent measurement system
    const p = eng.probe(0, 200, 200.01, U)
    // MPE = 0.02917, error = 0.01, margin = 0.01917
    // marginInU = 0.01917 / 0.001 = 19.17 — very safe
    expect(p.tur).toBeGreaterThan(MIN_TUR)
    expect(p.marginInU).toBeGreaterThan(1)
  })

  it('the report flags conditional when TUR < 4:1', () => {
    const eng = new CertificationEngine('test', 'C', MPE)
    const U = 0.010  // TUR ~ 2.9 — too large
    const probes = [eng.probe(0, 200, 200.01, U)]
    const report = eng.report(probes, U)
    expect(report.conditional).toBe(true)
    expect(report.worstTUR).toBeLessThan(MIN_TUR)
    expect(report.expandedUK2).toBe(U)
  })

  it('the report is unqualified when TUR ≥ 4:1', () => {
    const eng = new CertificationEngine('test', 'C', MPE)
    const U = 0.005  // TUR ~ 5.8 — safe
    const probes = [eng.probe(0, 200, 200.01, U)]
    const report = eng.report(probes, U)
    expect(report.conditional).toBeFalsy()
    expect(report.worstTUR).toBeGreaterThanOrEqual(MIN_TUR)
  })

  it('the GUM budget from UncertaintyBudget plugs into the engine', () => {
    const budget = new UncertaintyBudget()
    budget.addComponent('resolution', 0.014, 'd=0.05 kg')
    budget.addComponent('reference', 0.002, 'class F1 mass')
    budget.addComponent('repeatability', 0.003, '6 runs at 200 kg')
    const report = budget.report()
    const U = report.expanded

    const eng = new CertificationEngine('test', 'C', MPE)
    const probe = eng.probe(0, 200, 200.02, U)
    const testReport = eng.report([probe], U)

    // The budget's expanded U feeds into the TUR computation
    expect(probe.tur).toBeDefined()
    expect(testReport.expandedUK2).toBe(U)
    expect(testReport.worstTUR).toBeDefined()
    // TUR should be MPE / U = 0.02917 / ~0.015 ≈ 1.9 — too low
    // (the budget's components are deliberately large for this test)
  })

  it('a probe in the ISO 14253-1 uncertainty zone (0 < marginInU < 1) is flagged', () => {
    const eng = new CertificationEngine('test', 'C', MPE)
    // MPE = 0.02917, set error close to MPE, U moderately small
    const U = 0.006
    const error = 0.026  // inside the tolerance but close to the edge
    const probe = eng.probe(0, 200, 200 + error, U)
    // margin = 0.02917 - 0.026 = 0.00317
    // marginInU = 0.00317 / 0.006 = 0.528 — inside the uncertainty zone
    expect(probe.verdict).toBe('conforming')  // hard limit passes
    expect(probe.marginInU!).toBeGreaterThan(0)
    expect(probe.marginInU!).toBeLessThan(1)  // but uncertainty eats into the margin
  })
})
