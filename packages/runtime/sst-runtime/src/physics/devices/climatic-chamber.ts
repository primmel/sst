// physics/devices/climatic-chamber.ts — the climatic chamber: the
// environmental test equipment that realizes the temperature and
// humidity conditions of a type evaluation.
//
// Why this device exists: R 60-2's temperature and humidity tests do
// not teleport the cell to a condition — a CHAMBER ramps to a setpoint
// at a rated rate (IEC 60068-style), overshoots slightly on approach,
// and holds with a finite temporal stability. R 60-2, 2.7.3.1 bounds
// the usable stability (temperature differences during a test stay
// within one fifth of the cell's rated range, at most 2 °C), and
// 2.7.3.6 demands the stabilisation period — the cell's own thermal
// mass soaks AFTER the chamber air arrives, which the instrument's
// transduction stage already models (its thermal time constants). The
// chamber's job is the AIR: nominal setpoint in, realized climate out.
//
// The epistemics are the load application device's (same doctrine):
//
//   operator sets ──► NOMINAL setpoint (what the protocol demands)
//   chamber realizes ──► ACTUAL climate: ramp → slight overshoot →
//                     hold with stability noise; the cell soaks after
//                     the air, per its own constants
//
// The device is a bench peer of the instrument, never a stage in its
// signal chain. While engaged it owns the instrument's temperature and
// humidity (pressure stays a direct condition — chambers do not
// control it); the direct setEnvironment path (the idealized,
// instantaneous climate) disengages it. A chamber without humidity
// control (the R 60-3, 4.10.3 temperature chamber) leaves humidity to
// the direct path.

/** The chamber's configuration (its identity + rated performance). */
export interface ChamberSpec {
  /** Rated temperature ramp rate (°C per virtual minute). */
  tempRampDegCPerMin: number
  /** Temporal temperature stability at the setpoint (±°C, the amplitude
   *  of the hold noise). */
  tempStabilityDegC: number
  /** Approach overshoot (°C above/below the setpoint before settling). */
  tempOvershootDegC: number
  /** Humidity control: false for a temperature-only chamber
   *  (R 60-3, 4.10.3); true for the climatic chamber (4.10.4). */
  humidityControl: boolean
  /** Rated humidity ramp (%RH per virtual minute; humidityControl only). */
  humidityRampPercentRhPerMin: number
  /** Temporal humidity stability at the setpoint (±%RH). */
  humidityStabilityPercentRh: number
}

export type ChamberPhase = 'off' | 'ramping' | 'soaking' | 'holding'

/** The chamber's /world-visible state (the kind's GroundTruth extension). */
export interface ChamberState {
  engaged: boolean
  phase: ChamberPhase
  setpointTempDegC: number
  actualTempDegC: number
  setpointHumidityPercentRh: number | null
  actualHumidityPercentRh: number | null
  tempRampDegCPerMin: number
  tempStabilityDegC: number
  humidityControl: boolean
}

export class ClimaticChamber {
  #spec: ChamberSpec
  /** Seeded uniform RNG (the harness's determinism source). */
  #rng: () => number
  #engaged = false
  #phase: ChamberPhase = 'off'
  #setpointTemp = 20
  #setpointRh: number | null = null
  #actualTemp = 20
  #actualRh: number | null = null
  /** The overshoot still to decay (signed °C), set on arrival at a
   *  setpoint and decaying exponentially into the hold. */
  #overshootDegC = 0
  /** The hold-noise phase (a slow wander, not white noise). */
  #noiseT = 0

  constructor(spec: ChamberSpec, rng: () => number) {
    if (spec.tempRampDegCPerMin <= 0) throw new Error('[chamber] tempRampDegCPerMin must be positive')
    if (spec.tempStabilityDegC < 0 || spec.humidityStabilityPercentRh < 0) {
      throw new Error('[chamber] stabilities must be non-negative')
    }
    this.#spec = { ...spec }
    this.#rng = rng
  }

  /** Engage and drive toward the setpoints (temperature always; humidity
   *  only when the chamber has humidity control and a value is given).
   *  Starts from the CURRENT actuals (the lab ambient on first engage). */
  set(tempDegC: number, humidityPercentRh?: number): void {
    if (!Number.isFinite(tempDegC)) throw new Error('[chamber] temperature setpoint must be a number')
    this.#engaged = true
    this.#setpointTemp = tempDegC
    if (this.#spec.humidityControl && humidityPercentRh !== undefined) {
      this.#setpointRh = humidityPercentRh
      this.#actualRh ??= 50
    } else {
      this.#setpointRh = null
    }
    this.#phase = 'ramping'
  }

  /** Switch the chamber off: the climate drifts back toward the lab
   *  ambient (20 °C / 50 %RH) at the same rated ramp. */
  off(): void {
    this.#engaged = false
    this.#phase = 'off'
    this.#setpointTemp = 20
    this.#setpointRh = this.#spec.humidityControl ? 50 : null
  }

  /** Advance the chamber by dtS seconds of virtual time. */
  advance(dtS: number): void {
    if (this.#phase === 'off' && this.#actualTemp === this.#setpointTemp) return
    const tempStep = (this.#spec.tempRampDegCPerMin / 60) * dtS
    const delta = this.#setpointTemp - this.#actualTemp
    if (Math.abs(delta) > Math.abs(tempStep)) {
      this.#actualTemp += Math.sign(delta) * tempStep
      if (this.#engaged) this.#phase = 'ramping'
    } else {
      // Arrival: the overshoot kick, then the soak decays it.
      if (this.#phase === 'ramping' && this.#engaged && Math.abs(delta) > 1e-9) {
        this.#overshootDegC = Math.sign(delta) * this.#spec.tempOvershootDegC
        this.#phase = 'soaking'
      }
      this.#actualTemp = this.#setpointTemp
      if (this.#phase === 'ramping') this.#phase = this.#engaged ? 'soaking' : 'off'
    }
    if (this.#phase === 'soaking') {
      this.#overshootDegC *= Math.exp(-dtS / 300) // 5 min soak constant
      if (Math.abs(this.#overshootDegC) < this.#spec.tempStabilityDegC / 4) {
        this.#overshootDegC = 0
        this.#phase = this.#engaged ? 'holding' : 'off'
      }
    }
    if (this.#setpointRh !== null && this.#actualRh !== null) {
      const rhStep = (this.#spec.humidityRampPercentRhPerMin / 60) * dtS
      const dRh = this.#setpointRh - this.#actualRh
      this.#actualRh = Math.abs(dRh) <= rhStep ? this.#setpointRh : this.#actualRh + Math.sign(dRh) * rhStep
    }
    this.#noiseT += dtS
  }

  /** The realized temperature the instrument's environment feels: the
   *  ramp position, plus the decaying overshoot, plus the hold-noise
   *  wander bounded by the temporal stability. */
  actualTemperatureDegC(): number {
    if (this.#phase === 'off') return this.#actualTemp
    return this.#actualTemp + this.#overshootDegC + this.#wander(this.#spec.tempStabilityDegC)
  }

  /** The realized humidity (null when the chamber has no humidity
   *  control — the direct environment path owns it). */
  actualHumidityPercentRh(): number | null {
    if (this.#actualRh === null) return null
    if (this.#phase === 'off') return this.#actualRh
    return this.#actualRh + this.#wander(this.#spec.humidityStabilityPercentRh)
  }

  state(): ChamberState {
    return {
      engaged: this.#engaged,
      phase: this.#phase,
      setpointTempDegC: this.#setpointTemp,
      actualTempDegC: this.actualTemperatureDegC(),
      setpointHumidityPercentRh: this.#setpointRh,
      actualHumidityPercentRh: this.actualHumidityPercentRh(),
      tempRampDegCPerMin: this.#spec.tempRampDegCPerMin,
      tempStabilityDegC: this.#spec.tempStabilityDegC,
      humidityControl: this.#spec.humidityControl,
    }
  }

  /** A slow bounded wander in ±amp: two incommensurate sines with a
   *  seeded phase — deterministic per harness seed, and smooth enough
   *  to read as chamber control, not sensor noise. */
  #wander(amp: number): number {
    if (amp === 0) return 0
    const t = this.#noiseT
    const p = this.#rngPhase()
    return amp * 0.6 * Math.sin(t / 47 + p) + amp * 0.4 * Math.sin(t / 113 + 2 * p)
  }

  #rngPhaseValue: number | null = null
  #rngPhase(): number {
    this.#rngPhaseValue ??= this.#rng() * 2 * Math.PI
    return this.#rngPhaseValue
  }
}
