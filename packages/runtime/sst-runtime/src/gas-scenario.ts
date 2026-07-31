// gas-scenario.ts — the R 144 family's named analyzer definitions +
// physics presets (spec §8 idiom: scenarios are data, not code;
// validation is precise). The gas analogue of scenario.ts.
import {
  GAS_ANALYZER_GOOD,
  type GasAnalyzerDefinition, type GasChannelDefinition,
} from './gas-instrument.js'

export interface GasScenario extends GasAnalyzerDefinition {
  name: string
  description: string
}

/** Channel-wise parameter override helper — presets stay data. */
function channels(
  co: Partial<GasChannelDefinition['conditioning']>,
  nox: Partial<GasChannelDefinition['conditioning']>,
): GasChannelDefinition[] {
  const [coCh, noxCh] = GAS_ANALYZER_GOOD.channels
  return [
    { ...coCh!, conditioning: { ...coCh!.conditioning, ...co } },
    { ...noxCh!, conditioning: { ...noxCh!.conditioning, ...nox } },
  ]
}

export const GAS_SCENARIOS: Record<string, GasScenario> = {
  'good-analyzer': {
    ...GAS_ANALYZER_GOOD,
    name: 'good-analyzer',
    description: 'All coefficients inside R 144 limits — 7-day drift < MPE (4.8), cross-sensitivity < 0.5·MPE at 20 vol% CO2/H2O (4.5.2), T90 ≈ 69 s (4.6). Passes the test program.',
  },
  'drifting-analyzer': {
    id: 'cgm200-drifting',
    name: 'drifting-analyzer',
    description: 'Zero drift 1.2 ppm/day + span drift 1 %/day — inside MPE at 24 h but beyond it by day 7 (fails the R 144-2, 1.3 seven-day drift test while passing the daily check).',
    channels: channels(
      { zeroDriftPpmPerDay: 1.2, spanDriftPerDay: 0.01 },
      { zeroDriftPpmPerDay: 1.0, spanDriftPerDay: 0.01 },
    ),
    parameters: { ...GAS_ANALYZER_GOOD.parameters },
  },
  'span-shifted': {
    id: 'cgm200-span-shifted',
    name: 'span-shifted',
    description: 'A factory span miscalibration (+6 % span-reference error) — fails the span check at the top of the range until an instrument-legal spanCalibration against true span gas cures it.',
    channels: channels(
      { initialSpanErrorFraction: 0.06 },
      { initialSpanErrorFraction: 0.06 },
    ),
    parameters: { ...GAS_ANALYZER_GOOD.parameters },
  },
  'contaminated-optics': {
    id: 'cgm200-contaminated',
    name: 'contaminated-optics',
    description: 'Cell-window contamination (fraction 0.1) — adds absorbance on the CO (ndir) channel, reading ~25 ppm at zero gas, and attenuates NOx (cld) photon collection 10 %, a span loss. Zero calibration cures the CO offset; the NOx span loss needs cleaning.',
    channels: channels({}, {}),
    parameters: { ...GAS_ANALYZER_GOOD.parameters },
    initialFaults: { opticsContamination: 0.1 },
  },
}

export function getGasScenario(name: string): GasScenario {
  const s = GAS_SCENARIOS[name]
  if (!s) throw new Error(`unknown gas scenario '${name}' (known: ${Object.keys(GAS_SCENARIOS).join(', ')})`)
  return s
}

const TRANSDUCTION_KEYS: Record<string, string[]> = {
  ndir: ['principle', 'absorbancePerPpm', 'sourceAgingCompensation', 'contaminationAbsorbance'],
  cld: ['principle', 'photonRatePerPpm', 'darkRate', 'converterEfficiency', 'quenchPerPercentCo2', 'quenchPerPercentH2o'],
}
const CONDITIONING_KEYS = [
  'rangePpm', 'scaleIntervalPpm', 'spanGasPpm', 'filterTauS', 'noiseSigmaPpm',
  'tcZeroPpmPerDegC', 'tcSpanPerDegC', 'calibrationTempDegC', 'calibrationPressureKPa',
  'pressureCorrectionResidual', 'flowSensitivityPerLpm', 'flowBoundFraction', 'referenceFlowLPerMin',
  'xsCo2PpmPerPercent', 'xsH2oPpmPerPercent', 'xsBoundPpm',
  'zeroDriftPpmPerDay', 'spanDriftPerDay', 'initialSpanErrorFraction',
]

/** Validate an authored gas-analyzer scenario record (definitions are
 *  data) — throws with the first precise field error. */
export function validateGasScenario(raw: unknown): GasScenario {
  const r = raw as Record<string, unknown>
  for (const k of ['id', 'name', 'description'] as const) {
    if (typeof r?.[k] !== 'string' || (r[k] as string).length === 0) throw new Error(`scenario.${k}: required non-empty string`)
  }
  const chs = r.channels
  if (!Array.isArray(chs) || chs.length === 0) throw new Error('scenario.channels: required non-empty array')
  for (const ch of chs as Array<Record<string, unknown>>) {
    if (typeof ch.component !== 'string' || ch.component.length === 0) throw new Error('scenario.channels[].component: required non-empty string')
    const t = ch.transduction as Record<string, unknown> | undefined
    if (!t || typeof t !== 'object') throw new Error(`scenario.channels[${ch.component}].transduction: required object`)
    const principle = t.principle
    if (principle !== 'ndir' && principle !== 'cld') throw new Error(`scenario.channels[${ch.component}].transduction.principle: one of ndir, cld (got '${String(principle)}')`)
    for (const k of TRANSDUCTION_KEYS[principle]!) {
      if (k === 'principle') continue
      if (typeof t[k] !== 'number') throw new Error(`scenario.channels[${ch.component}].transduction.${k}: required number`)
    }
    const c = ch.conditioning as Record<string, unknown> | undefined
    if (!c || typeof c !== 'object') throw new Error(`scenario.channels[${ch.component}].conditioning: required object`)
    for (const k of CONDITIONING_KEYS) {
      if (typeof c[k] !== 'number') throw new Error(`scenario.channels[${ch.component}].conditioning.${k}: required number`)
    }
    if (typeof ch.warmUpOffsetPpm !== 'number') throw new Error(`scenario.channels[${ch.component}].warmUpOffsetPpm: required number`)
  }
  const p = r.parameters as Record<string, unknown> | undefined
  if (!p || typeof p !== 'object') throw new Error('scenario.parameters: required object')
  for (const k of ['warmUpTauS', 'warmUpSpanResidual']) {
    if (typeof p[k] !== 'number') throw new Error(`scenario.parameters.${k}: required number`)
  }
  const f = r.initialFaults as Record<string, unknown> | undefined
  if (f !== undefined) {
    if (typeof f !== 'object') throw new Error('scenario.initialFaults: required object when present')
    if (f.opticsContamination !== undefined && typeof f.opticsContamination !== 'number') throw new Error('scenario.initialFaults.opticsContamination: required number when present')
    if (f.sourceAgingRatePerDay !== undefined && typeof f.sourceAgingRatePerDay !== 'number') throw new Error('scenario.initialFaults.sourceAgingRatePerDay: required number when present')
  }
  return r as unknown as GasScenario
}
