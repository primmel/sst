// certification/verdict.ts — the MPE enforcement engine with GUM-
// load-bearing TUR verification.
//
// The SST platform's value proposition: the sim demonstrates both a
// passing instrument and a failing one. This module is the third-actor
// component that samples the /twin indication and /world ground truth
// at scheduled probe points, computes the error, compares against the
// per-class MPE envelope, and emits pass/fail verdicts.
//
// After TODO 38, the GUM uncertainty budget is LOAD-BEARING:
//   - The Test Uncertainty Ratio (TUR = U/MPE) must be ≥ 4:1 (ILAC-G8).
//     If TUR < 4:1, the test is conditional — the verdict carries a
//     warning that the measurement uncertainty is too large relative
//     to the tolerance.
//   - Each probe carries the conformance margin (MPE − error) expressed
//     in units of the expanded uncertainty — the ISO 14253-1 decision
//     gauge. A margin > 0 means the error is inside the conformance
//     zone with room; a margin < 0 means the error eats into the
//     uncertainty zone.

/** The per-class MPE step function (from the kind's mpe.yaml). */
export interface MpeBand {
  intervals: [number, number]    // [low, high] in v_min units (high = Infinity for unbounded)
  factor: number                             // multiplier × v_min × p_lc
}

export interface MpeClass {
  bands: MpeBand[]
}

export interface MpeConfig {
  classes: Record<string, MpeClass>
  vMin: number           // the verification interval (kg)
  pLc: number            // the apportionment factor (typically 0.7)
}

/** The minimum TUR for an unqualified pass (ILAC-G8 §4.2). */
export const MIN_TUR = 4.0

/** One probe point's result. */
export interface ProbeResult {
  /** The virtual time (s) the probe was taken. */
  atS: number
  /** The applied load (ground truth from /world). */
  loadKg: number
  /** The served indication (from /twin). */
  indicationKg: number
  /** The absolute error: |indication - load|. */
  errorKg: number
  /** The MPE at this load (kg). */
  mpeKg: number
  /** The error as a fraction of MPE. >1 = non-conforming. */
  errorFractionOfMpe: number
  /** The verdict for this probe. */
  verdict: 'conforming' | 'non-conforming'
  /** The conformance margin: MPE − |error| (kg). Positive = inside
   *  the tolerance; negative = over. When the GUM budget is supplied,
   *  this accounts for the expanded uncertainty (see marginInU). */
  marginKg: number
  /** The margin expressed in units of the expanded uncertainty U(k=2).
   *  > 1 → comfortably inside the conformance zone (ISO 14253-1).
   *  0–1 → inside the uncertainty zone (conditional pass).
   *  < 0 → non-conforming. Only present when U is known. */
  marginInU?: number | undefined
  /** The TUR at this probe point: MPE / U(k=2). ≥ 4 = safe. */
  tur?: number | undefined
}

/** A full test report. */
export interface TestReport {
  instrumentId: string
  accuracyClass: string
  vMin: number
  pLc: number
  probes: ProbeResult[]
  overall: 'pass' | 'fail'
  failingProbes: ProbeResult[]
  /** True when the TUR < 4:1 at any probe — the test results are
   *  conditional (the measurement uncertainty is too large relative
   *  to the tolerance). The overall verdict is still pass/fail but
   *  carries this warning. */
  conditional?: boolean | undefined
  /** The worst-case TUR across all probes. ≥ 4 = safe. */
  worstTUR?: number | undefined
  /** The expanded uncertainty U(k=2) used for TUR computation (kg). */
  expandedUK2?: number | undefined
}

/** Compute the MPE (in kg) at a given load, per the class's band table. */
export function mpeAt(loadKg: number, className: string, config: MpeConfig): number {
  const cls = config.classes[className]
  if (!cls) return Infinity
  const intervals = loadKg / config.vMin
  for (const band of cls.bands) {
    const [lo, hi] = band.intervals
    if (intervals >= lo && intervals < hi) {
      return band.factor * config.vMin * config.pLc
    }
  }
  const last = cls.bands[cls.bands.length - 1]
  return (last?.factor ?? 1) * config.vMin * config.pLc
}

/** The certification engine — samples the instrument at probe points
 *  and emits a structured test report with GUM-load-bearing TUR. */
export class CertificationEngine {
  #mpeConfig: MpeConfig
  #className: string
  #instrumentId: string

  constructor(instrumentId: string, className: string, mpeConfig: MpeConfig) {
    this.#instrumentId = instrumentId
    this.#className = className
    this.#mpeConfig = mpeConfig
  }

  /** Sample one probe point: compare indication vs reference.
   *  When expandedU (k=2) is supplied, the probe carries the
   *  conformance margin in U and the TUR. */
  probe(atS: number, loadKg: number, indicationKg: number, expandedU?: number): ProbeResult {
    const errorKg = Math.abs(indicationKg - loadKg)
    const mpeKg = mpeAt(loadKg, this.#className, this.#mpeConfig)
    const errorFractionOfMpe = mpeKg > 0 ? errorKg / mpeKg : 0
    const marginKg = mpeKg - errorKg
    const result: ProbeResult = {
      atS, loadKg, indicationKg, errorKg, mpeKg,
      errorFractionOfMpe,
      verdict: errorFractionOfMpe <= 1 ? 'conforming' : 'non-conforming',
      marginKg,
    }
    if (expandedU != null && expandedU > 0) {
      result.marginInU = marginKg / expandedU
      result.tur = mpeKg / expandedU
    }
    return result
  }

  /** Compile a test report from a set of probes. When expandedU is
   *  supplied, the report carries the TUR and the conditional flag. */
  report(probes: ProbeResult[], expandedU?: number): TestReport {
    const failing = probes.filter(p => p.verdict === 'non-conforming')
    const report: TestReport = {
      instrumentId: this.#instrumentId,
      accuracyClass: this.#className,
      vMin: this.#mpeConfig.vMin,
      pLc: this.#mpeConfig.pLc,
      probes,
      overall: failing.length === 0 ? 'pass' : 'fail',
      failingProbes: failing,
    }
    if (expandedU != null && expandedU > 0) {
      const turs = probes.map(p => p.tur ?? (p.mpeKg / expandedU)).filter(t => Number.isFinite(t) && t > 0)
      const worst = turs.length > 0 ? Math.min(...turs) : Infinity
      report.worstTUR = worst
      report.expandedUK2 = expandedU
      report.conditional = worst < MIN_TUR
    }
    return report
  }
}

/** Parse the kind's mpe.yaml into the MpeConfig shape. */
export function parseMpeConfig(yaml: {
  classes: Record<string, { bands: Array<{ intervals: Array<number | string>; factor: number }> }>
  additional_limits?: { creep?: { limit: number } }
}, vMin: number, pLc = 0.7): MpeConfig {
  const classes: Record<string, MpeClass> = {}
  for (const [name, cls] of Object.entries(yaml.classes)) {
    classes[name] = {
      bands: cls.bands.map(b => ({
        intervals: [
          typeof b.intervals[0] === 'string' ? Number(b.intervals[0]) : (b.intervals[0] as number),
          b.intervals[1] === '∞' || b.intervals[1] === 'Infinity' ? Infinity : Number(b.intervals[1]),
        ] as [number, number],
        factor: b.factor,
      })),
    }
  }
  return { classes, vMin, pLc }
}
