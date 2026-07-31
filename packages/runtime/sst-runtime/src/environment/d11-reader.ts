// environment/d11-reader.ts — read D 11 condition + profile files from
// the base package and construct EnvironmentalProgram objects.
//
// The base package declares D 11 conditions as YAML files under
// conditions/ and canonical profiles under profiles/. This module
// bridges them to the EnvironmentalResponseLayer's program shape.

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parse } from 'yaml'
import type { EnvironmentalProgram, ProfileKeyframe } from './response.js'

interface D11Condition {
  id: string
  kind: 'steady' | 'cyclic' | 'transient'
  classification: 'influence' | 'disturbance'
  severity_levels: Array<Record<string, unknown>>
  constraints?: Record<string, unknown>
}

interface D11Profile {
  id: string
  condition: string
  total_duration_h: number
  loop: boolean
  keyframes: Array<{ at_h: number; temperature_degC?: number; humidity_pct_rh?: number }>
  constraints?: Record<string, unknown>
  level_target_degC?: Record<string, number>
}

/** Read a D 11 condition file from the base package. */
export async function loadCondition(baseDir: string, conditionId: string, level = 0): Promise<D11Condition | null> {
  try {
    const text = await readFile(join(baseDir, 'conditions', `${conditionId}.yaml`), 'utf-8')
    const parsed = parse(text) as D11Condition
    return parsed
  } catch { return null }
}

/** Read a D 11 profile file and convert to an EnvironmentalProgram. */
export async function loadProfileAsProgram(baseDir: string, profileId: string): Promise<EnvironmentalProgram | null> {
  try {
    const text = await readFile(join(baseDir, 'profiles', `${profileId}.yaml`), 'utf-8')
    const profile = parse(text) as D11Profile

    // Convert hours to seconds
    const keyframes: ProfileKeyframe[] = (profile.keyframes ?? []).map(kf => ({
      atS: (kf.at_h ?? 0) * 3600,
      temperatureDegC: kf.temperature_degC,
      humidityPercentRh: kf.humidity_pct_rh,
    }))

    return {
      keyframes,
      events: [],
      loop: profile.loop ?? false,
      totalDurationS: (profile.total_duration_h ?? 1) * 3600,
    }
  } catch { return null }
}

/** Build a dry-heat steady program at a specific temperature level. */
export async function buildDryHeatProgram(baseDir: string, level: number): Promise<EnvironmentalProgram | null> {
  const cond = await loadCondition(baseDir, 'dry-heat', level)
  if (!cond) return null
  const sev = cond.severity_levels[level] ?? cond.severity_levels[0]
  if (!sev) return null
  const temp = sev.temperature_degC as number ?? 40
  const duration = (sev.duration_h as number ?? 2) * 3600

  return {
    keyframes: [
      { atS: 0, temperatureDegC: 25 },
      { atS: duration / 4, temperatureDegC: temp },
      { atS: duration * 3 / 4, temperatureDegC: temp },
      { atS: duration, temperatureDegC: 25 },
    ],
    events: [],
    loop: false,
    totalDurationS: duration,
  }
}
