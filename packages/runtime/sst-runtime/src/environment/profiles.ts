// environment/profiles.ts — D 11 environment as time programs on the
// virtual clock (spec §5): keyframed profiles with slew-limited replay
// (the test methods' ramp rules, e.g. ≤ 1 °C/min).
import type { VirtualClock } from '../time.js'
import type { Environment } from '../instrument.js'

export interface ProfileKeyframe { atS: number; env: Partial<Environment> }

export interface ProfileProgram {
  id: string
  standard: string
  keyframes: ProfileKeyframe[]
  /** slew limits per quantity (units per second) — replay never
   *  exceeds them even across a step keyframe. */
  maxRampPerS?: Partial<Record<keyof Environment, number>>
  /** loop the program (cyclic profiles) — default: play once, hold last. */
  loop?: boolean
}

export const D11_PROFILES: Record<string, ProfileProgram> = {
  'damp-heat-cyclic-db': {
    id: 'damp-heat-cyclic-db', standard: 'IEC 60068-2-30 Db (D 11, 10.4)',
    loop: true,
    keyframes: [
      { atS: 0, env: { temperatureDegC: 25, humidityPercentRh: 95 } },
      { atS: 3 * 3600, env: { temperatureDegC: 55, humidityPercentRh: 95 } },
      { atS: 12 * 3600, env: { temperatureDegC: 55, humidityPercentRh: 95 } },
      { atS: 15 * 3600, env: { temperatureDegC: 25, humidityPercentRh: 95 } },
      { atS: 24 * 3600, env: { temperatureDegC: 25, humidityPercentRh: 95 } },
    ],
    maxRampPerS: { temperatureDegC: 1 / 60 }, // the method's ≤ 1 °C/min
  },
  'damp-heat-steady-cab': {
    id: 'damp-heat-steady-cab', standard: 'IEC 60068-2-78 Cab (D 11, 10.5)',
    keyframes: [
      { atS: 0, env: { temperatureDegC: 40, humidityPercentRh: 93 } },
    ],
    maxRampPerS: { temperatureDegC: 1 / 60 },
  },
  'dry-heat-bb2': {
    id: 'dry-heat-bb2', standard: 'IEC 60068-2-2 BB2 (D 11, 10.2)',
    keyframes: [
      { atS: 0, env: { temperatureDegC: 20, humidityPercentRh: 50 } },
      { atS: 2 * 3600, env: { temperatureDegC: 55, humidityPercentRh: 20 } },
    ],
    maxRampPerS: { temperatureDegC: 1 / 60 },
  },
  'cold-aa1': {
    id: 'cold-aa1', standard: 'IEC 60068-2-1 AA1 (D 11, 10.3)',
    keyframes: [
      { atS: 0, env: { temperatureDegC: 20, humidityPercentRh: 50 } },
      { atS: 2 * 3600, env: { temperatureDegC: -10 } },
    ],
    maxRampPerS: { temperatureDegC: 1 / 60 },
  },
}

type Key = keyof Environment

/** Plays a ProfileProgram onto an apply() sink as the clock advances:
 *  linear interpolation between keyframes, slew-limited per quantity,
 *  looping when the program says so. Deterministic (driven only by
 *  VirtualClock advance notifications). */
export class ProfilePlayer {
  #program: ProfileProgram
  #off: (() => void) | undefined

  constructor(program: ProfileProgram) { this.#program = program }

  start(clock: VirtualClock, apply: (e: Partial<Environment>) => void): void {
    const program = this.#program
    let programT = 0
    let current: Partial<Environment> = { ...program.keyframes[0]!.env }
    apply({ ...current })
    this.#off = clock.onAdvance(dt => {
      programT += dt
      const duration = program.keyframes[program.keyframes.length - 1]!.atS
      const t = program.loop && duration > 0 ? programT % duration : Math.min(programT, duration)
      const target = interpolate(program.keyframes, t)
      current = slew(current, target, program.maxRampPerS ?? {}, dt)
      apply({ ...current })
    })
  }

  stop(): void { this.#off?.(); this.#off = undefined }
}

/** Linear interpolation of the keyframed environment at program time t. */
export function interpolate(keyframes: ProfileKeyframe[], t: number): Partial<Environment> {
  if (keyframes.length === 1) return { ...keyframes[0]!.env }
  let i = 0
  while (i < keyframes.length - 2 && keyframes[i + 1]!.atS <= t) i++
  const a = keyframes[i]!, b = keyframes[i + 1]!
  const span = b.atS - a.atS
  const f = span <= 0 ? 1 : Math.min(1, Math.max(0, (t - a.atS) / span))
  const out: Partial<Environment> = {}
  const keys = new Set<Key>([...Object.keys(a.env), ...Object.keys(b.env)] as Key[])
  for (const k of keys) {
    const av = (a.env as Record<Key, number | undefined>)[k]
    const bv = (b.env as Record<Key, number | undefined>)[k]
    if (av !== undefined && bv !== undefined) (out as Record<Key, number>)[k] = av + (bv - av) * f
    else if (av !== undefined && f < 1) (out as Record<Key, number>)[k] = av
    else if (bv !== undefined && f >= 1) (out as Record<Key, number>)[k] = bv
  }
  return out
}

/** Move `current` toward `target`, limited per quantity to rate×dt. */
export function slew(
  current: Partial<Environment>, target: Partial<Environment>,
  maxRamp: Partial<Record<Key, number>>, dt: number,
): Partial<Environment> {
  const out: Partial<Environment> = { ...current }
  for (const k of Object.keys(target) as Key[]) {
    const tv = (target as Record<Key, number | undefined>)[k]
    if (tv === undefined) continue
    const cv = (current as Record<Key, number | undefined>)[k] ?? tv
    const rate = maxRamp[k]
    const delta = tv - cv
    ;(out as Record<Key, number>)[k] = rate === undefined ? tv : cv + Math.sign(delta) * Math.min(Math.abs(delta), rate * dt)
  }
  return out
}
