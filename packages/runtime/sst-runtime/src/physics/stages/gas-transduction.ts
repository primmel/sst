// stages/gas-transduction.ts — the gas-analyzer measurement principle
// (the R 144 family's stage-2 analogue of the strain-gauge bridge):
// gas composition → raw detector-domain signal, physically shaped per
// principle. Two principles (the reference methods of stationary-source
// emissions monitoring, EN 15058 / EN 14792, which R 144-2 cites):
//
//   ndir  non-dispersive infrared absorption (the CO channel):
//         Beer–Lambert — absorbance is linear in the NUMBER DENSITY of
//         absorbing molecules, so the raw signal is exponential in
//         concentration and responds to cell T/P, never a gain knob.
//   cld   chemiluminescence detection (the NOx channel): NO + O3 →
//         NO2* + hν — the photon rate is linear in molecule density,
//         quenched by third-body collisions (Stern–Volmer in CO2/H2O),
//         and only the NO2 share passes the converter (efficiency η).
//
// Faults realize HERE, in the physics: optics contamination adds
// absorbance in the ndir measurement path (not ratiometric-compensated)
// and attenuates cld photon collection; source aging drifts the ndir
// zero between calibrations (residual after reference-beam
// compensation). Nothing touches the indication directly.

/** R 144-1, 4.1 reference conditions: 273.15 K, 101.325 kPa. */
export const GAS_REFERENCE = { temperatureK: 273.15, pressureKPa: 101.325 } as const

/** Number density of the cell gas relative to the R 144 reference
 *  conditions (ideal gas): n/n_ref = (P/P_ref)·(T_ref/T). */
export function gasDensity(temperatureDegC: number, pressureKPa: number): number {
  return (pressureKPa / GAS_REFERENCE.pressureKPa) * (GAS_REFERENCE.temperatureK / (temperatureDegC + 273.15))
}

/** The gas actually in the measurement cell (world-side truth, already
 *  leak-diluted by the instrument composition — the stage never sees
 *  the undiluted stream). */
export interface GasSample {
  /** measurand volume fraction, ppm (NOx channel: total NO+NO2). */
  measurandPpm: number
  /** the NO2 share of NOx (cld only — the converter acts on it). */
  no2Fraction: number
  co2PercentVol: number
  h2oPercentVol: number
  /** cell temperature/pressure (a vented cell: the chamber conditions). */
  temperatureDegC: number
  pressureKPa: number
}

export interface NdirTransductionParams {
  principle: 'ndir'
  /** Beer–Lambert absorbance per ppm at reference density (AU/ppm). */
  absorbancePerPpm: number
  /** reference-beam compensation of source aging, 0..1 (1 = perfect
   *  ratio compensation; the residual is the between-calibration drift). */
  sourceAgingCompensation: number
  /** absorbance added at contamination fraction 1 (AU) — cell-window
   *  deposits sit in the measurement path only. */
  contaminationAbsorbance: number
}

export interface CldTransductionParams {
  principle: 'cld'
  /** photon rate per ppm at reference density (counts/ppm). */
  photonRatePerPpm: number
  /** baseline photon rate — dark counts (counts). */
  darkRate: number
  /** NO2→NO converter efficiency, 0..1. */
  converterEfficiency: number
  /** Stern–Volmer quench coefficients (1 per vol% interferent). */
  quenchPerPercentCo2: number
  quenchPerPercentH2o: number
}

export type GasTransductionParams = NdirTransductionParams | CldTransductionParams

export class GasTransductionStage {
  #contamination = 0
  #agingRatePerDay = 0
  #agingDriftAU = 0

  constructor(private readonly p: GasTransductionParams) {}

  get principle(): GasTransductionParams['principle'] { return this.p.principle }

  /** Accumulate the source-aging residual (ndir): the compensated
   *  intensity ratio decays at (1−ρ)·λ, which reads as absorbance
   *  drift between calibrations. */
  advance(dtS: number): void {
    if (this.p.principle !== 'ndir') return
    this.#agingDriftAU += (1 - this.p.sourceAgingCompensation) * this.#agingRatePerDay * (dtS / 86400)
  }

  /** The raw detector-domain signal: apparent absorbance (AU) for ndir,
   *  photon rate (counts) for cld. Ground truth — /world only. */
  output(sample: GasSample): number {
    const density = gasDensity(sample.temperatureDegC, sample.pressureKPa)
    if (this.p.principle === 'ndir') {
      // Beer–Lambert: A = k·c·(n/n_ref) + contamination + aging residual.
      return this.p.absorbancePerPpm * sample.measurandPpm * density
        + this.p.contaminationAbsorbance * this.#contamination
        + this.#agingDriftAU
    }
    // cld: photon rate ∝ molecules in the chamber; the NO2 share counts
    // at converter efficiency; Stern–Volmer quenching by CO2/H2O; the
    // view-window contamination attenuates collection multiplicatively.
    const effective = sample.measurandPpm
      * ((1 - sample.no2Fraction) + this.p.converterEfficiency * sample.no2Fraction)
    const quench = 1 / (1 + this.p.quenchPerPercentCo2 * sample.co2PercentVol
      + this.p.quenchPerPercentH2o * sample.h2oPercentVol)
    return (this.p.darkRate + this.p.photonRatePerPpm * effective * density * quench)
      * (1 - this.#contamination)
  }

  /** /world-only fault knob: optics contamination fraction, 0..1.
   *  Realized per principle (ndir: additive absorbance; cld:
   *  multiplicative collection loss). Never the indication. */
  setContamination(fraction: number): void {
    if (!(fraction >= 0 && fraction <= 1)) throw new Error(`optics contamination fraction must be in 0..1, got ${fraction}`)
    this.#contamination = fraction
  }
  get contamination(): number { return this.#contamination }

  /** /world-only fault knob: source aging rate (relative intensity loss
   *  per day; ndir). 0 = no aging. */
  setSourceAgingRate(perDay: number): void {
    if (!(perDay >= 0)) throw new Error(`source aging rate must be ≥ 0, got ${perDay}`)
    this.#agingRatePerDay = perDay
  }
  get sourceAgingRatePerDay(): number { return this.#agingRatePerDay }
  /** The accumulated aging residual (AU) — ground truth, /world only. */
  get agingDriftAU(): number { return this.#agingDriftAU }

  reset(): void { this.#contamination = 0; this.#agingRatePerDay = 0; this.#agingDriftAU = 0 }
}
