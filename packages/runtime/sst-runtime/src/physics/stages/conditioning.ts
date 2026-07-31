export type TechnologyStack = 'analog-passive'|'analog-active'|'digital'|'digital-processing'
export interface ConditioningParams {
  stack: TechnologyStack; scaleIntervalKg: number; capacityKg: number
  filterTauS: number; linearizationErrorKg: number
  compensationResidualPerDegC: number; noiseSigmaKg: number
}

/** The technology stacks (spec §4.3). passive: passthrough. active:
 *  amplifier offset+noise. digital: + IIR filter, linearization,
 *  temperature-compensation residual, ADC quantization to d.
 *  digital-processing: + self-diagnostics hook (faults list).
 *  kgPerMVperV is a process() parameter because calibration belongs
 *  to the instrument composition, not to the stack. */
export class ConditioningStage {
  #filtered = 0; #primed = false
  constructor(private readonly p: ConditioningParams, private readonly normal: () => number) {}

  process(bridgeMVperV: number, dtS: number, env: { temperatureDegC: number }, kgPerMVperV = 250): { indicationKg: number; faults: string[] } {
    let kg = bridgeMVperV * kgPerMVperV
    const faults: string[] = []
    if (this.p.stack === 'analog-passive') return { indicationKg: kg, faults }

    // active and above: amplifier noise
    kg += this.normal() * this.p.noiseSigmaKg
    if (this.p.stack === 'analog-active') return { indicationKg: kg, faults }

    // digital and above: filter, linearization, compensation residual
    if (!this.#primed) { this.#filtered = kg; this.#primed = true }
    const alpha = 1 - Math.exp(-dtS / this.p.filterTauS)
    this.#filtered += (kg - this.#filtered) * alpha
    kg = this.#filtered + this.p.linearizationErrorKg + this.p.compensationResidualPerDegC * (env.temperatureDegC - 20)
    kg = Math.round(kg / this.p.scaleIntervalKg) * this.p.scaleIntervalKg
    if (this.p.stack === 'digital-processing' && Math.abs(kg) > this.p.capacityKg * 1.5) faults.push('overload')
    return { indicationKg: kg, faults }
  }
}
