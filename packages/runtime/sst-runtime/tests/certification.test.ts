import { describe, it, expect } from 'vitest'
import { CertificationEngine, mpeAt, parseMpeConfig, type MpeConfig } from '../src/certification/verdict.js'

// The R 60 class C MPE envelope from packages/kinds/sst-r60/mpe.yaml
const R60_CLASS_C_CONFIG: MpeConfig = {
  vMin: 500 / 6000,     // ≈ 0.0833 kg (E_max / n_lc)
  pLc: 0.7,
  classes: {
    C: {
      bands: [
        { intervals: [0, 500], factor: 0.5 },
        { intervals: [500, 2000], factor: 1.0 },
        { intervals: [2000, 4000], factor: 1.5 },
        { intervals: [4000, Infinity], factor: 2.0 },
      ],
    },
  },
}

describe('TODO 16 — certification verdict layer', () => {
  it('computes the MPE at various loads per the class-C step function', () => {
    const mpe = (load: number) => mpeAt(load, 'C', R60_CLASS_C_CONFIG)
    // At low load (≤ 500 intervals ≈ 41.7 kg): 0.5 × v_min × p_lc
    expect(mpe(10)).toBeCloseTo(0.5 * R60_CLASS_C_CONFIG.vMin * 0.7, 5)
    // At mid load (500-2000 intervals ≈ 41.7-166.7 kg): 1.0 × v_min × p_lc
    expect(mpe(100)).toBeCloseTo(1.0 * R60_CLASS_C_CONFIG.vMin * 0.7, 5)
    // At high load (2000-4000 intervals ≈ 166.7-333.3 kg): 1.5 × v_min × p_lc
    expect(mpe(250)).toBeCloseTo(1.5 * R60_CLASS_C_CONFIG.vMin * 0.7, 5)
  })

  it('a conforming probe (error within MPE) gets verdict conforming', () => {
    const eng = new CertificationEngine('test-good', 'C', R60_CLASS_C_CONFIG)
    // Place 40 kg, indicate 40.01 kg → error 0.01 kg < MPE
    const result = eng.probe(0, 40, 40.01)
    expect(result.verdict).toBe('conforming')
    expect(result.errorFractionOfMpe).toBeLessThan(1)
  })

  it('a non-conforming probe (error exceeds MPE) gets verdict non-conforming', () => {
    const eng = new CertificationEngine('test-bad', 'C', R60_CLASS_C_CONFIG)
    // Place 40 kg, indicate 42 kg → error 2 kg >> MPE (~0.029 kg)
    const result = eng.probe(0, 40, 42)
    expect(result.verdict).toBe('non-conforming')
    expect(result.errorFractionOfMpe).toBeGreaterThan(1)
  })

  it('compiles a passing test report when all probes conform', () => {
    const eng = new CertificationEngine('good-cell', 'C', R60_CLASS_C_CONFIG)
    const probes = [
      eng.probe(0, 0, 0),
      eng.probe(60, 40, 40.005),
      eng.probe(120, 200, 200.01),
      eng.probe(180, 400, 399.98),
    ]
    const report = eng.report(probes)
    expect(report.overall).toBe('pass')
    expect(report.failingProbes).toHaveLength(0)
  })

  it('compiles a FAILING test report when any probe exceeds MPE', () => {
    const eng = new CertificationEngine('creep-cell', 'C', R60_CLASS_C_CONFIG)
    const probes = [
      eng.probe(0, 40, 40.005),        // conforming
      eng.probe(1800, 40, 41.0),       // NON-conforming — creep drifted 1 kg
      eng.probe(3600, 40, 42.0),       // NON-conforming — creep drifted 2 kg
    ]
    const report = eng.report(probes)
    expect(report.overall).toBe('fail')
    expect(report.failingProbes).toHaveLength(2)
    expect(report.failingProbes[0]!.errorKg).toBeCloseTo(1.0, 3)
  })

  it('catches the lying-twin scenario (served offset exceeds MPE)', () => {
    const eng = new CertificationEngine('lying-twin', 'C', R60_CLASS_C_CONFIG)
    // The ground truth is 40 kg; the twin serves 40.25 kg (0.25 kg offset)
    const result = eng.probe(0, 40, 40.25)
    // MPE at 40 kg is ~0.029 kg; an offset of 0.25 kg exceeds it by ~8.5×
    expect(result.verdict).toBe('non-conforming')
    expect(result.errorFractionOfMpe).toBeGreaterThan(5)
  })

  it('parses the kind mpe.yaml shape into MpeConfig', () => {
    const yamlShape = {
      classes: {
        C: {
          bands: [
            { intervals: [0, 500], factor: 0.5 },
            { intervals: [500, '∞'], factor: 1.0 },
          ],
        },
      },
    }
    const config = parseMpeConfig(yamlShape, 0.0833, 0.7)
    expect(config.classes.C.bands[1]!.intervals[1]).toBe(Infinity)
    expect(config.vMin).toBe(0.0833)
  })
})
