// physics/devices/indicating-instrument.ts — the indicating instrument:
// the laboratory's readout device, the second half of R 60-2, 2.7.2's
// "a force-generating system and a suitable indicating instrument".
//
// Why this device exists: an analogue-passive load cell does not
// indicate anything — it presents a bridge signal (mV/V). The READING
// in kilograms is formed by the laboratory's indicating instrument,
// which is itself a measuring device with its own calibration state:
// a systematic gain error and zero offset (within its verification
// class), a display resolution (its scale interval) and readout noise.
// R 60-2, 2.7.3.6's stabilisation period applies to the pair — the
// cell under test AND the indicating instrument.
//
// The epistemics (the bench's uniform doctrine):
//
//   cell presents ──► the bridge signal (mV/V) — the cell's legal output
//   indicator forms ──► the READING in kg: bridge × conversion ×
//                     (1 + gain error) + offset, quantized to the
//                     indicator's own scale interval, with readout noise
//
// For digital and analogue-active stacks the instrument's own
// electronics form the indication (the conditioning stage does) — the
// bench indicator is inactive there by construction. The device is a
// bench peer of the instrument, never a stage in its signal chain.

/** The indicator's configuration (its identity + verification state). */
export interface IndicatorSpec {
  /** Bridge-to-mass conversion constant (kg per mV/V — the cell's
   *  capacity / rated output, declared on the bench for the pairing). */
  kgPerMVperV: number
  /** The indicator's systematic gain error (its calibration state), as
   *  a fraction of the reading (e.g. 3e-5 ≙ ±0.003 %). */
  gainErrorFraction: number
  /** The indicator's systematic zero offset (kg). */
  offsetKg: number
  /** The indicator's own scale interval (kg) — its display resolution. */
  scaleIntervalKg: number
  /** Readout noise (kg, one sigma). */
  noiseSigmaKg: number
}

/** The indicator's /world-visible state. */
export interface IndicatorState {
  present: boolean
  kgPerMVperV: number
  gainErrorFraction: number
  offsetKg: number
  scaleIntervalKg: number
  /** The last reading formed (kg). */
  readingKg: number
}

export class IndicatingInstrument {
  #spec: IndicatorSpec
  /** The readout-noise source (seeded; Box-Muller). */
  #noise: () => number
  #readingKg = 0

  constructor(spec: IndicatorSpec, normalNoise: () => number) {
    if (spec.kgPerMVperV <= 0) throw new Error('[indicator] kgPerMVperV must be positive')
    if (spec.scaleIntervalKg <= 0) throw new Error('[indicator] scaleIntervalKg must be positive')
    this.#spec = { ...spec }
    this.#noise = normalNoise
  }

  /** Form the reading from the cell's bridge output (mV/V): conversion,
   *  the calibration state (gain + offset), readout noise, and the
   *  indicator's own display quantization. */
  read(bridgeMVperV: number): number {
    const raw = bridgeMVperV * this.#spec.kgPerMVperV
    const withCalibration = raw * (1 + this.#spec.gainErrorFraction) + this.#spec.offsetKg
    const noisy = withCalibration + this.#noise() * this.#spec.noiseSigmaKg
    this.#readingKg = Math.round(noisy / this.#spec.scaleIntervalKg) * this.#spec.scaleIntervalKg
    return this.#readingKg
  }

  state(): IndicatorState {
    return {
      present: true,
      kgPerMVperV: this.#spec.kgPerMVperV,
      gainErrorFraction: this.#spec.gainErrorFraction,
      offsetKg: this.#spec.offsetKg,
      scaleIntervalKg: this.#spec.scaleIntervalKg,
      readingKg: this.#readingKg,
    }
  }
}
