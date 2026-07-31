export interface TransductionParams {
  sensitivityMVperV: number; gaugeFactor: number; excitationV: number
  tcZeroPerDegC: number; tcSpanPerDegC: number; barometricPerKPa: number
  referenceTempDegC: number; referencePressureKPa: number
  /** Thermal hysteresis (the post-cycle residual): after a temperature
   *  excursion the zero carries a slow-relaxing offset toward
   *  thermalHysteresisPerDegC × ΔT — distinct from the instantaneous,
   *  fully-reversible T_C0/T_Cspan coefficients. User-configurable
   *  (0 = perfectly reversible). */
  thermalHysteresisPerDegC: number
  /** Relaxation time constant of the thermal memory, seconds. */
  thermalHysteresisTauS: number
}

/** The strain-gauge Wheatstone bridge (spec §4.1 stage 2): linear
 *  temperature coefficients on zero and span; barometric offset on
 *  dead load (R 60-1, 5.6.2); thermal hysteresis memory (advance()).
 *  Output in mV/V. */
export class TransductionStage {
  #thermalOffset = 0
  constructor(private readonly p: TransductionParams) {}

  /** Advance the thermal memory: the zero offset relaxes toward
   *  perDegC × ΔT at the thermal-hysteresis time constant. */
  advance(dtS: number, env: { temperatureDegC: number }): void {
    const target = this.p.thermalHysteresisPerDegC * (env.temperatureDegC - this.p.referenceTempDegC)
    const tau = this.p.thermalHysteresisTauS
    if (tau > 0) this.#thermalOffset += (target - this.#thermalOffset) * (1 - Math.exp(-dtS / tau))
  }

  /** User-configurable knob (spec: the post-cycle difference is
   *  operator-settable): retune the thermal memory live. */
  setThermalHysteresis(perDegC: number, tauS: number): void {
    if (!(perDegC >= 0)) throw new Error(`thermalHysteresisPerDegC must be ≥ 0, got ${perDegC}`)
    if (!(tauS > 0)) throw new Error(`thermalHysteresisTauS must be > 0, got ${tauS}`)
    ;(this.p as { thermalHysteresisPerDegC: number; thermalHysteresisTauS: number }).thermalHysteresisPerDegC = perDegC
    ;(this.p as { thermalHysteresisPerDegC: number; thermalHysteresisTauS: number }).thermalHysteresisTauS = tauS
  }

  /** The current tuning (for /world queries). */
  get thermalHysteresis(): { perDegC: number; tauS: number } {
    return { perDegC: this.p.thermalHysteresisPerDegC, tauS: this.p.thermalHysteresisTauS }
  }

  /** The current thermal-hysteresis offset (ground truth — /world only). */
  get thermalOffsetMVperV(): number { return this.#thermalOffset }

  output(strainMm: number, env: { temperatureDegC: number; pressureKPa: number }): number {
    const dT = env.temperatureDegC - this.p.referenceTempDegC
    const dP = env.pressureKPa - this.p.referencePressureKPa
    const span = this.p.sensitivityMVperV * (1 + this.p.tcSpanPerDegC * dT)
    const zero = this.p.tcZeroPerDegC * dT + this.p.barometricPerKPa * dP
    return span * strainMm + zero + this.#thermalOffset
  }
}
