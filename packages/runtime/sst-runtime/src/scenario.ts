// scenario.ts — named instrument definitions + physics presets
// (spec §8: scenarios are data, not code; validation is precise).
import type { InstrumentDefinition, InstrumentParameters } from './instrument.js'
import type { ConstructionProfile } from './physics/families/construction.js'
import { COMPRESSION } from './physics/families/construction.js'
import { LC500_GOOD } from './instrument.js'

export interface Scenario extends InstrumentDefinition {
  name: string
  description: string
}

const GOOD_PARAMS: InstrumentParameters = LC500_GOOD.parameters

export const SCENARIOS: Record<string, Scenario> = {
  'good-cell': {
    ...LC500_GOOD,
    name: 'good-cell',
    description: 'All coefficients inside R 60 limits — passes the test program.',
  },
  'creep-cell': {
    id: 'lc500-creep',
    name: 'creep-cell',
    description: 'Creep coefficient/τ beyond MPE — fails the 30-minute creep test.',
    construction: { ...COMPRESSION, id: 'compression-creep', creepCoefficient: 0.004, creepTauS: 120 },
    stack: 'digital',
    parameters: { ...GOOD_PARAMS },
  },
  'temp-cell': {
    id: 'lc500-temp',
    name: 'temp-cell',
    description: 'Excessive temperature coefficients on zero and span (plus a strong thermal-hysteresis memory) — fails the temperature tests.',
    construction: 'compression',
    stack: 'digital',
    parameters: {
      ...GOOD_PARAMS,
      tcZeroPerDegC: 0.001, tcSpanPerDegC: 0.002, compensationResidualPerDegC: 0.005,
      thermalHysteresisPerDegC: 0.0002, thermalHysteresisTauS: 1800,
    },
  },
  'drift-cell': {
    id: 'lc500-drift',
    name: 'drift-cell',
    description: 'Excessive span drift — fails span-stability over the endurance program.',
    construction: 'compression',
    stack: 'digital',
    parameters: { ...GOOD_PARAMS, spanDriftPerDay: 0.0005 },
  },
  // ── fidelity scenarios (spec §8.1 — honest physics, dishonest twin) ──
  'lying-twin': {
    id: 'lc500-lying',
    name: 'lying-twin',
    description: 'Honest physics; the served indication carries a firmware-mapping offset (a twin-fidelity fault — the certification must catch it).',
    construction: 'compression',
    stack: 'digital',
    parameters: { ...GOOD_PARAMS },
    fidelity: { servedOffsetKg: 0.25, servedLagS: 0 },
  },
  'stale-twin': {
    id: 'lc500-stale',
    name: 'stale-twin',
    description: 'Honest physics and values; servedAt lags beyond freshness (a twin-freshness fault).',
    construction: 'compression',
    stack: 'digital',
    parameters: { ...GOOD_PARAMS },
    fidelity: { servedOffsetKg: 0, servedLagS: 30 },
  },

  // ── R 60 multi-manufacturer / multi-class catalog (TODO 2026-07-30) ──
  // Real R 60 cells span classes A/B/C/D with characteristic n_lc, E_max,
  // dr, v_min per R 60-1 §3.5–§3.7. The samples below mirror the
  // diversity of the smart-r60 reference catalog (Hottinger Brüel & Kjaer
  // HLCi, Mettler Toledo, Vishay) plus the canonical ACME LC-500. Each
  // model carries one or more physical samples — fresh, aged, dropped,
  // corroded — with parameter overrides that match the symptom.

  // Manufacturer: Hottinger Brüel & Kjaer (HBK) — family HLCi (3.3 t)
  // Reference: smart-r60/models/source/sample-data.yaml (DE1/PTB flow).
  'hbk-hlci-c6-fresh': {
    id: 'hbk-hlci-c6-fresh',
    name: 'hbk-hlci-c6-fresh',
    description: 'HBK HLCi class C6 3.3 t, fresh from the factory — all coefficients inside R 60 limits.',
    construction: 'compression',
    stack: 'digital',
    parameters: {
      ...GOOD_PARAMS,
      capacityKg: 3300, scaleIntervalKg: 0.55,
      noiseSigmaKg: 0.05, linearizationErrorKg: 0.05,
    },
  },
  'hbk-hlci-c6-aged': {
    id: 'hbk-hlci-c6-aged',
    name: 'hbk-hlci-c6-aged',
    description: 'HBK HLCi C6 3.3 t, 5 years in service — span drift and hysteresis memory up; passes R 60 but barely.',
    construction: { ...COMPRESSION, id: 'compression-aged', creepCoefficient: 0.0005, hysteresisClass: 0.55 },
    stack: 'digital',
    parameters: { ...GOOD_PARAMS, capacityKg: 3300, scaleIntervalKg: 0.55, spanDriftPerDay: 0.00004, noiseSigmaKg: 0.08 },
  },
  'hbk-hlci-d1-fresh': {
    id: 'hbk-hlci-d1-fresh',
    name: 'hbk-hlci-d1-fresh',
    description: 'HBK HLCi class D1 3.3 t — coarse accuracy, large MPE. For industrial weighing where tolerance is generous.',
    construction: 'compression',
    stack: 'digital',
    parameters: {
      ...GOOD_PARAMS,
      capacityKg: 3300, scaleIntervalKg: 3.3,   // n_lc ≈ 1000 (D1)
      noiseSigmaKg: 0.5, linearizationErrorKg: 0.5,
    },
  },

  // Manufacturer: Mettler Toledo — family MTS (500 kg)
  'mtb-mts-c3-fresh': {
    id: 'mtb-mts-c3-fresh',
    name: 'mtb-mts-c3-fresh',
    description: 'Mettler Toledo MTS class C3 500 kg — n_lc 3000, mid-range industrial. Fresh sample.',
    construction: 'compression',
    stack: 'digital',
    parameters: {
      ...GOOD_PARAMS,
      capacityKg: 500, scaleIntervalKg: 500 / 3000,  // ≈ 0.167
      noiseSigmaKg: 0.02,
    },
  },
  'mtb-mts-c3-dropped': {
    id: 'mtb-mts-c3-dropped',
    name: 'mtb-mts-c3-dropped',
    description: 'Mettler Toledo MTS C3 500 kg, dropped in handling — offset shift and non-linearity; would fail R 60 linearity.',
    construction: { ...COMPRESSION, id: 'compression-damaged', hysteresisClass: 0.6 },
    stack: 'digital',
    parameters: {
      ...GOOD_PARAMS,
      capacityKg: 500, scaleIntervalKg: 500 / 3000,
      linearizationErrorKg: 0.3, noiseSigmaKg: 0.04,
    },
    fidelity: { servedOffsetKg: 0.4, servedLagS: 0 },
  },

  // Manufacturer: Vishay Celtron — heavy industrial (10 t)
  'vishay-csh-c6-fresh': {
    id: 'vishay-csh-c6-fresh',
    name: 'vishay-csh-c6-fresh',
    description: 'Vishay Celtron CSH class C6 10 t — heavy industrial compression, n_lc 6000.',
    construction: 'compression',
    stack: 'digital',
    parameters: {
      ...GOOD_PARAMS,
      capacityKg: 10000, scaleIntervalKg: 10 / 6,   // ≈ 1.67 kg
      noiseSigmaKg: 0.5, linearizationErrorKg: 0.5,
    },
  },
  'vishay-csh-c6-corroded': {
    id: 'vishay-csh-c6-corroded',
    name: 'vishay-csh-c6-corroded',
    description: 'Vishay Celtron CSH C6 10 t, corroded (marine environment) — drift and noise up, would fail endurance.',
    construction: { ...COMPRESSION, id: 'compression-corroded', creepCoefficient: 0.0008 },
    stack: 'digital',
    parameters: {
      ...GOOD_PARAMS,
      capacityKg: 10000, scaleIntervalKg: 10 / 6,
      spanDriftPerDay: 0.0001, noiseSigmaKg: 1.5,
    },
  },
}

export function getScenario(name: string): Scenario {
  const s = SCENARIOS[name]
  if (!s) throw new Error(`unknown scenario '${name}' (known: ${Object.keys(SCENARIOS).join(', ')})`)
  return s
}

const PARAM_KEYS: Array<keyof InstrumentParameters> = [
  'capacityKg', 'scaleIntervalKg', 'sensitivityMVperV', 'gaugeFactor', 'excitationV',
  'tcZeroPerDegC', 'tcSpanPerDegC', 'barometricPerKPa', 'referenceTempDegC', 'referencePressureKPa',
  'thermalHysteresisPerDegC', 'thermalHysteresisTauS',
  'filterTauS', 'linearizationErrorKg', 'compensationResidualPerDegC', 'noiseSigmaKg',
  'warmUpTauS', 'spanDriftPerDay',
]
const PROFILE_KEYS: Array<keyof ConstructionProfile> = [
  'id', 'complianceKgPerMm', 'hysteresisClass', 'creepCoefficient', 'creepTauS', 'resonantHz', 'offCenterSensitivity',
]
const STACKS = new Set(['analog-passive', 'analog-active', 'digital', 'digital-processing'])

/** Validate an authored scenario record (spec §8: definitions are
 *  data) — throws with the first precise field error. */
export function validateScenario(raw: unknown): Scenario {
  const r = raw as Record<string, unknown>
  for (const k of ['id', 'name', 'description'] as const) {
    if (typeof r?.[k] !== 'string' || (r[k] as string).length === 0) throw new Error(`scenario.${k}: required non-empty string`)
  }
  const c = r.construction
  if (typeof c === 'string') {
    if (c.length === 0) throw new Error('scenario.construction: empty profile id')
  } else if (c && typeof c === 'object') {
    for (const k of PROFILE_KEYS) {
      const v = (c as Record<string, unknown>)[k]
      if (k === 'id' ? typeof v !== 'string' : typeof v !== 'number') throw new Error(`scenario.construction.${k}: required ${k === 'id' ? 'string' : 'number'}`)
    }
  } else {
    throw new Error('scenario.construction: profile id or inline profile required')
  }
  if (typeof r.stack !== 'string' || !STACKS.has(r.stack)) throw new Error(`scenario.stack: one of ${[...STACKS].join(', ')} (got '${String(r.stack)}')`)
  const p = r.parameters as Record<string, unknown> | undefined
  if (!p || typeof p !== 'object') throw new Error('scenario.parameters: required object')
  for (const k of PARAM_KEYS) {
    if (typeof p[k] !== 'number') throw new Error(`scenario.parameters.${k}: required number`)
  }
  const f = r.fidelity as Record<string, unknown> | undefined
  if (f !== undefined) {
    if (typeof f !== 'object') throw new Error('scenario.fidelity: required object when present')
    if (typeof f.servedOffsetKg !== 'number') throw new Error('scenario.fidelity.servedOffsetKg: required number')
    if (typeof f.servedLagS !== 'number') throw new Error('scenario.fidelity.servedLagS: required number')
  }
  return r as unknown as Scenario
}
