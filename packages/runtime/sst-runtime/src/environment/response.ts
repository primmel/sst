// environment/response.ts — the D 11 → physics response layer.
//
// Connects the base package's D 11 condition profiles to the composed
// instrument's physics. Two modes:
//
//   INFLUENCE (continuous): temperature, humidity, barometric, supply
//   voltage shift the instrument's coefficients. The ComposedInstrument
//   already applies TC coefficients via the TransductionStage; this
//   layer drives the environment values from the D 11 profile timeline.
//
//   DISTURBANCE (transient): bursts, surges, ESD, vibration, shock
//   inject fault events at scheduled timestamps. The instrument's
//   operational state latches to 'fault' during the event window.

import type { ComposedInstrument } from '../stages/composer.js'
import type { VirtualClock } from '../time.js'

/** A D 11 profile keyframe (the environmental conditions at a point in time). */
export interface ProfileKeyframe {
  atS: number
  temperatureDegC?: number
  humidityPercentRh?: number
  pressureKPa?: number
}

/** A D 11 disturbance event (an EMC/mechanical transient). */
export interface DisturbanceEvent {
  atS: number
  durationS: number
  kind: 'burst' | 'surge' | 'esd' | 'vibration' | 'shock' | 'dip' | 'rf'
  severity: number
}

/** A scheduled environmental program: a sequence of keyframes + events. */
export interface EnvironmentalProgram {
  keyframes: ProfileKeyframe[]
  events: DisturbanceEvent[]
  loop: boolean
  totalDurationS: number
}

/** The response layer that drives the instrument's environment from
 *  a D 11 program. Call tick() on each simulation step. */
export class EnvironmentalResponseLayer {
  #instrument: ComposedInstrument
  #clock: VirtualClock
  #program: EnvironmentalProgram | null = null
  #firedEvents = new Set<number>()

  constructor(instrument: ComposedInstrument, clock: VirtualClock) {
    this.#instrument = instrument
    this.#clock = clock
  }

  /** Load a D 11 environmental program. Subsequent ticks will drive
   *  the instrument's environment from the program's keyframes and
   *  fire disturbance events at their scheduled times. */
  playProgram(program: EnvironmentalProgram): void {
    this.#program = program
    this.#firedEvents.clear()
  }

  /** Stop the current program. The environment holds its last value. */
  stopProgram(): void {
    this.#program = null
  }

  /** Advance the environmental response by one tick. Called from the
   *  session's main loop alongside ComposedInstrument.tick(). */
  tick(): void {
    if (!this.#program) return
    const t = this.#clock.now() % (this.#program.totalDurationS || 1)

    // Interpolate the environment from the keyframes.
    const env = this.#interpolateKeyframes(t)
    if (env) {
      this.#instrument.setEnvironment(env)
    }

    // Fire any disturbance events whose timestamp has been reached.
    for (let i = 0; i < this.#program.events.length; i++) {
      const ev = this.#program.events[i]!
      if (!this.#firedEvents.has(i) && t >= ev.atS) {
        this.#firedEvents.add(i)
        this.#fireDisturbance(ev)
      }
    }
  }

  /** Interpolate the current environment from the keyframe timeline. */
  #interpolateKeyframes(t: number): { temperatureDegC?: number; humidityPercentRh?: number; pressureKPa?: number } | null {
    const kfs = this.#program!.keyframes
    if (kfs.length === 0) return null
    if (kfs.length === 1) return kfs[0]!

    // Find the surrounding keyframes.
    let i = 0
    while (i < kfs.length - 1 && kfs[i + 1]!.atS <= t) i++
    const k0 = kfs[i]!
    const k1 = kfs[i + 1] ?? k0
    if (k1.atS === k0.atS) return k0

    const u = (t - k0.atS) / (k1.atS - k0.atS)
    const lerp = (a: number | undefined, b: number | undefined): number | undefined =>
      a == null || b == null ? a : a + (b - a) * u

    return {
      temperatureDegC: lerp(k0.temperatureDegC, k1.temperatureDegC),
      humidityPercentRh: lerp(k0.humidityPercentRh, k1.humidityPercentRh),
      pressureKPa: lerp(k0.pressureKPa, k1.pressureKPa),
    }
  }

  /** Fire a disturbance event: latch a fault for the event's duration. */
  #fireDisturbance(ev: DisturbanceEvent): void {
    this.#instrument.injectFault()
    // Schedule the clear after the event's duration.
    const clearAtS = ev.atS + ev.durationS
    const check = () => {
      if (this.#clock.now() >= clearAtS) {
        this.#instrument.clearFault()
      } else {
        setTimeout(check, 10)
      }
    }
    // In a real session, the clock is manual-stepped; the clear happens
    // on the next tick where t >= clearAtS. This simplified version uses
    // setTimeout for the wall-clock path; the manual-step path checks
    // clearAtS in the tick() loop (TODO 15 full execution).
    if (this.#clock.mode() === 'wall') {
      setTimeout(check, ev.durationS * 1000)
    }
  }
}

/** Build the canonical damp-heat-cyclic-db program from the D 11 spec. */
export function dampHeatCyclicDb(upperTempDegC: number): EnvironmentalProgram {
  return {
    keyframes: [
      { atS: 0,     temperatureDegC: 25, humidityPercentRh: 95 },
      { atS: 3 * 3600, temperatureDegC: upperTempDegC, humidityPercentRh: 95 },
      { atS: 12 * 3600, temperatureDegC: upperTempDegC, humidityPercentRh: 93 },
      { atS: 18 * 3600, temperatureDegC: 25, humidityPercentRh: 95 },
      { atS: 24 * 3600, temperatureDegC: 25, humidityPercentRh: 95 },
    ],
    events: [],
    loop: true,
    totalDurationS: 24 * 3600,
  }
}

/** Build a burst disturbance event (IEC 61000-4-4). */
export function burstEvent(atS: number, severity: number): DisturbanceEvent {
  return { atS, durationS: 0.015, kind: 'burst', severity }
}

/** Build an ESD event (IEC 61000-4-2). */
export function esdEvent(atS: number, contactKv: number): DisturbanceEvent {
  return { atS, durationS: 0.001, kind: 'esd', severity: contactKv }
}
