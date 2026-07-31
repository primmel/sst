import { describe, it, expect } from 'vitest'
import { VirtualClock } from '../time.js'
import { ProfilePlayer, D11_PROFILES, type ProfileProgram } from './profiles.js'
import { REFERENCE_ENVIRONMENT, type Environment } from '../instrument.js'

function replay(program: ProfileProgram, durationS: number, stepS = 1): Environment[] {
  const clock = new VirtualClock()
  let env: Environment = { ...REFERENCE_ENVIRONMENT }
  const seen: Environment[] = []
  const player = new ProfilePlayer(program)
  player.start(clock, e => { env = { ...env, ...e }; seen.push({ ...env }) })
  while (clock.now() < durationS) clock.advance(stepS)
  player.stop()
  return seen
}

describe('D 11 profiles (IEC 60068-2-30 Db cyclic)', () => {
  const db = D11_PROFILES['damp-heat-cyclic-db']!

  it('t=0 applies the cycle start (25 °C, ≥95 %Rh)', () => {
    const seen = replay(db, 0)
    expect(seen[0]!.temperatureDegC).toBe(25)
    expect(seen[0]!.humidityPercentRh).toBeGreaterThanOrEqual(95)
  })
  it('reaches the upper phase (55 °C class) by mid-cycle', () => {
    const seen = replay(db, 12 * 3600)
    const last = seen[seen.length - 1]!
    expect(last.temperatureDegC).toBeCloseTo(55, 1)
  })
  it('temperature ramps never exceed 1 °C/min', () => {
    const seen = replay(db, 6 * 3600, 1)
    for (let i = 1; i < seen.length; i++) {
      const dT = Math.abs(seen[i]!.temperatureDegC - seen[i - 1]!.temperatureDegC)
      expect(dT).toBeLessThanOrEqual(1 / 60 + 1e-9)
    }
  })
  it('replay is deterministic (two runs, identical trajectories)', () => {
    const a = replay(db, 3600, 10).map(e => e.temperatureDegC)
    const b = replay(db, 3600, 10).map(e => e.temperatureDegC)
    expect(a).toEqual(b)
  })
})

describe('ProfilePlayer ramp limiting', () => {
  it('a step keyframe is slew-limited, not jumped', () => {
    const step: ProfileProgram = {
      id: 'step-test', standard: 'test',
      keyframes: [
        { atS: 0, env: { temperatureDegC: 20 } },
        { atS: 1, env: { temperatureDegC: 80 } }, // would jump +60 without limiting
      ],
      maxRampPerS: { temperatureDegC: 1 / 60 },
    }
    const seen = replay(step, 3600, 1)
    for (let i = 1; i < seen.length; i++) {
      expect(Math.abs(seen[i]!.temperatureDegC - seen[i - 1]!.temperatureDegC)).toBeLessThanOrEqual(1 / 60 + 1e-9)
    }
    expect(seen[seen.length - 1]!.temperatureDegC).toBeCloseTo(80, 6) // reaches it in 60 min
  })
})
