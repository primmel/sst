// certification/uncertainty.ts — the GUM-compliant measurement uncertainty budget.
//
// Per the Guide to the Expression of Uncertainty in Measurement (GUM):
//   - Type A uncertainty: statistical, from repeated observations
//   - Type B uncertainty: systematic, from calibration certificates,
//     manufacturer specs, engineering judgment
//   - Combined uncertainty: u_c = sqrt(Σ u_i²) (assuming independence)
//   - Expanded uncertainty: U = k × u_c (k=2 for 95% confidence)

export interface UncertaintyComponent {
  name: string
  type: 'A' | 'B'
  /** Standard uncertainty (1σ), in the measurement unit (kg). */
  u: number
  /** Degrees of freedom (for Type A; Type B is typically ∞). */
  dof: number
  /** Description of the source. */
  source: string
}

export class UncertaintyBudget {
  #components: UncertaintyComponent[] = []
  #indicationHistory: number[] = []
  #historyMax = 30

  /** Record an indication reading for Type A analysis. */
  recordIndication(value: number): void {
    this.#indicationHistory.push(value)
    if (this.#indicationHistory.length > this.#historyMax) {
      this.#indicationHistory.shift()
    }
  }

  /** Add a Type B uncertainty component. */
  addComponent(name: string, u: number, source: string, dof = Infinity): void {
    this.#components.push({ name, type: 'B', u, dof, source })
  }

  /** Compute the Type A uncertainty from the indication history.
   *  This is the standard deviation of the mean: s / sqrt(n). */
  typeAUncertainty(): number {
    const n = this.#indicationHistory.length
    if (n < 2) return 0
    const mean = this.#indicationHistory.reduce((s, v) => s + v, 0) / n
    const variance = this.#indicationHistory.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1)
    return Math.sqrt(variance) / Math.sqrt(n)
  }

  /** Compute the combined standard uncertainty per GUM. */
  combinedUncertainty(): number {
    const typeA = this.typeAUncertainty()
    const typeB = this.#components.reduce((s, c) => s + c.u ** 2, 0)
    return Math.sqrt(typeA ** 2 + typeB)
  }

  /** Compute the expanded uncertainty U = k × u_c (default k=2 for 95%). */
  expandedUncertainty(k = 2): number {
    return k * this.combinedUncertainty()
  }

  /** Generate the full budget report. */
  report(): {
    typeA: { u: number; n: number; mean: number; stdDev: number }
    typeB: UncertaintyComponent[]
    combined: number
    expanded: number
    k: number
    confidence: string
  } {
    const n = this.#indicationHistory.length
    const mean = n > 0 ? this.#indicationHistory.reduce((s, v) => s + v, 0) / n : 0
    const stdDev = n > 1
      ? Math.sqrt(this.#indicationHistory.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1))
      : 0
    const typeA = this.typeAUncertainty()
    return {
      typeA: { u: typeA, n, mean, stdDev },
      typeB: this.#components.filter(c => c.type === 'B'),
      combined: this.combinedUncertainty(),
      expanded: this.expandedUncertainty(2),
      k: 2,
      confidence: '~95% (coverage factor k=2)',
    }
  }
}
