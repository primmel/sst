// physics/devices/load-application-device.ts — the load application
// device (LAD): the laboratory's force-generating system that realizes
// the test loads of a force/mass instrument under test.
//
// Why this device exists (the modelling correction): an R 60 type
// evaluation does NOT place reference weights on the load cell. R 60-2,
// 2.7.2 states that the basic equipment for the tests consists of "a
// force-generating system and a suitable indicating instrument" — a
// deadweight force standard machine or a servo-hydraulic press applies
// the force, axially and without shock (R 60-2, 2.7.3.3), ramped at a
// controlled rate. The machine is itself a measuring device: it has a
// capacity, a calibration state (a systematic relative error within its
// class limits, the ISO 376 analog) and a per-application repeatability.
//
// The epistemics the simulator teaches:
//
//   operator sets ──► NOMINAL target load (what the protocol demands,
//                     what the test report records as the test load)
//   machine realizes ──► ACTUAL load = ramp(t) × (1 + ε_cal) + ε_rep
//                     (what the cell under test physically feels — the
//                     ground truth; the difference is bounded by the
//                     machine's class and feeds the uncertainty budget)
//
// The device is a BENCH peer of the instrument, never a stage in its
// signal chain: the ComposedInstrument reads the device's actual output
// as its applied load while the device is engaged; the direct
// placeMass/removeMass path (the idealized deadweight placement)
// disengages it.
//
// All loads are expressed in mass units (kg) — R 60 expresses test loads
// in mass units; the force/mass conversion runs through the local
// acceleration of gravity (R 60-2, 2.7.3.2), which the laboratory
// declares as a test condition, not a device property.

/** The device's configuration (its identity + calibration state). */
export interface LadSpec {
  /** Maximum force the machine can apply, in mass units (kg). */
  capacityKg: number
  /** The bound of the machine's systematic relative indication error
   *  (the ISO 376 class analog: 5e-4 ≙ 0.05 %, class 0.5). The realized
   *  systematic error is drawn once at construction within ±this bound —
   *  it is the machine's calibration state, constant across applications. */
  classFraction: number
  /** The per-application relative repeatability (standard deviation of
   *  the realized load around the ramped setpoint, as a fraction of the
   *  target). */
  repeatabilityFraction: number
  /** The default loading rate (kg/s) — the shock-free ramp of
   *  R 60-2, 2.7.3.3. apply()/release() may override per call. */
  defaultRateKgPerS: number
}

export type LadPhase = 'idle' | 'applying' | 'holding' | 'releasing'

/** The device's /world-visible state (the kind's GroundTruth extension). */
export interface LadState {
  engaged: boolean
  phase: LadPhase
  /** The operator's nominal setpoint (kg). */
  targetKg: number
  /** The ramp's current nominal position (kg). */
  nominalKg: number
  /** The load the instrument physically feels right now (kg). */
  actualKg: number
  /** The active ramp rate (kg/s). */
  rateKgPerS: number
  capacityKg: number
  classFraction: number
  repeatabilityFraction: number
  /** The machine's realized systematic relative error (its calibration
   *  state) — within ±classFraction, fixed at construction. */
  calErrorFraction: number
}

export class LoadApplicationDevice {
  #spec: LadSpec
  /** Seeded uniform RNG (the harness's determinism source). */
  #rng: () => number
  /** The machine's calibration state: systematic relative error, drawn
   *  once, constant across applications (re-drawn only by recalibrate()). */
  #calError: number
  /** The per-application repeatability offset (kg), drawn at each apply(). */
  #repOffsetKg = 0
  #engaged = false
  #phase: LadPhase = 'idle'
  #targetKg = 0
  #nominalKg = 0
  #rateKgPerS: number

  constructor(spec: LadSpec, rng: () => number) {
    if (spec.capacityKg <= 0) throw new Error('[lad] capacityKg must be positive')
    if (spec.classFraction < 0 || spec.repeatabilityFraction < 0) {
      throw new Error('[lad] error fractions must be non-negative')
    }
    if (spec.defaultRateKgPerS <= 0) throw new Error('[lad] defaultRateKgPerS must be positive')
    this.#spec = { ...spec }
    this.#rng = rng
    this.#calError = (rng() * 2 - 1) * spec.classFraction
    this.#rateKgPerS = spec.defaultRateKgPerS
  }

  /** Engage the device and ramp toward the nominal target load. A target
   *  beyond the machine's capacity is refused (the machine cannot realize
   *  it — the protocol must pick a machine that covers D_max). */
  apply(targetKg: number, rateKgPerS?: number): void {
    if (!Number.isFinite(targetKg) || targetKg < 0) throw new Error('[lad] target load must be a non-negative number')
    if (targetKg > this.#spec.capacityKg) {
      throw new Error(`[lad] target ${targetKg} kg exceeds the machine's capacity ${this.#spec.capacityKg} kg`)
    }
    this.#engaged = true
    this.#targetKg = targetKg
    this.#rateKgPerS = rateKgPerS && rateKgPerS > 0 ? rateKgPerS : this.#spec.defaultRateKgPerS
    // Each application realizes a slightly different load: draw the
    // repeatability offset now so the ramp moves toward the realized
    // value (the machine settles INTO its per-application error).
    this.#repOffsetKg = this.#gauss() * this.#spec.repeatabilityFraction * targetKg
    this.#phase = 'applying'
  }

  /** Ramp back to the dead load (target 0). */
  release(rateKgPerS?: number): void {
    this.#engaged = true
    this.#targetKg = 0
    this.#rateKgPerS = rateKgPerS && rateKgPerS > 0 ? rateKgPerS : this.#spec.defaultRateKgPerS
    this.#repOffsetKg = 0
    this.#phase = 'releasing'
  }

  /** Disengage the device (the direct placeMass path takes over). The
   *  calibration state survives — it is the machine's identity. */
  disengage(): void {
    this.#engaged = false
    this.#phase = 'idle'
    this.#targetKg = 0
    this.#nominalKg = 0
    this.#repOffsetKg = 0
  }

  /** A new calibration state (the machine was recalibrated between
   *  engagements): re-draw the systematic error within the class bound. */
  recalibrate(): void {
    this.#calError = (this.#rng() * 2 - 1) * this.#spec.classFraction
  }

  /** Advance the ramp by dtS seconds of virtual time. */
  advance(dtS: number): void {
    if (!this.#engaged || (this.#phase !== 'applying' && this.#phase !== 'releasing')) return
    const step = this.#rateKgPerS * dtS
    const delta = this.#targetKg - this.#nominalKg
    if (Math.abs(delta) <= step) {
      this.#nominalKg = this.#targetKg
      this.#phase = this.#targetKg === 0 ? 'idle' : 'holding'
      return
    }
    this.#nominalKg += Math.sign(delta) * step
  }

  /** The load the instrument physically feels: the ramped nominal
   *  position scaled by the machine's systematic error, plus the
   *  per-application repeatability offset. */
  actualKg(): number {
    if (!this.#engaged) return 0
    return this.#nominalKg * (1 + this.#calError) + this.#repOffsetKg
  }

  state(): LadState {
    return {
      engaged: this.#engaged,
      phase: this.#phase,
      targetKg: this.#targetKg,
      nominalKg: this.#nominalKg,
      actualKg: this.actualKg(),
      rateKgPerS: this.#rateKgPerS,
      capacityKg: this.#spec.capacityKg,
      classFraction: this.#spec.classFraction,
      repeatabilityFraction: this.#spec.repeatabilityFraction,
      calErrorFraction: this.#calError,
    }
  }

  /** Box-Muller on the seeded uniform RNG (deterministic per harness seed). */
  #gauss(): number {
    const u = Math.max(this.#rng(), Number.EPSILON)
    const v = this.#rng()
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
  }
}
