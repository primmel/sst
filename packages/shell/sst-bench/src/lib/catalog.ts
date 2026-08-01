// catalog.ts — the R 60 instrument catalog: manufacturer → model → sample.
// Each sample references a scenario in @primmel/sst-runtime/scenario by name; the
// InstrumentChooser navigates the catalog and runs `scenario <name>` on
// selection. The values mirror real R 60 classifications (smart-r60/
// models/source/sample-data.yaml) — class A/B/C/D × n_lc × E_max × dr.
//
// Adding a sample here requires the matching scenario to exist in core.
// Adding a manufacturer or model is data-only.

export type AccuracyClass = 'A' | 'B' | 'C' | 'D'
export type Technology = 'analog-passive' | 'analog-active' | 'digital' | 'digital-processing'
export type Construction = 'compression' | 'shear-beam' | 'bending-beam' | 's-type' | 'single-point'
export type DamageKind = 'fresh' | 'aged' | 'dropped' | 'overloaded' | 'corroded' | 'creep-fail' | 'temp-fail' | 'drift-fail' | 'lying-twin' | 'stale-twin'

export interface Sample {
  id: string
  scenarioId: string
  serialNumber: string
  sampleName: string
  description: string
  damageKind: DamageKind
}

export interface Model {
  id: string
  designation: string
  manufacturerId: string
  accuracyClass: AccuracyClass
  classNumber: number
  eMaxKg: number
  nLc: number
  technology: Technology
  construction: Construction
  humiditySymbol: 'CH' | 'SH' | 'NH'
  ratedTempDegC: readonly [number, number]
  samples: Sample[]
}

export interface Manufacturer {
  id: string
  name: string
  shortName: string
  country: string
  models: Model[]
}

const ACME_MODELS: Model[] = [
  {
    id: 'mdl-acme-lc500-c6-500kg',
    designation: 'ACME LC-500',
    manufacturerId: 'mfr-acme',
    accuracyClass: 'C', classNumber: 6,
    eMaxKg: 500, nLc: 6000,
    technology: 'digital', construction: 'compression',
    humiditySymbol: 'CH',
    ratedTempDegC: [-10, 40],
    samples: [
      { id: 'acme-lc500-good',     scenarioId: 'good-cell',   serialNumber: 'LC500-001', sampleName: 'fresh',       description: 'All coefficients inside R 60 limits.', damageKind: 'fresh' },
      { id: 'acme-lc500-creep',    scenarioId: 'creep-cell',  serialNumber: 'LC500-002', sampleName: 'creep-fail',  description: 'Creep coefficient/τ beyond MPE — fails the 30-min test.', damageKind: 'creep-fail' },
      { id: 'acme-lc500-temp',     scenarioId: 'temp-cell',   serialNumber: 'LC500-003', sampleName: 'temp-fail',   description: 'Excessive temperature coefficients.', damageKind: 'temp-fail' },
      { id: 'acme-lc500-drift',    scenarioId: 'drift-cell',  serialNumber: 'LC500-004', sampleName: 'drift-fail',  description: 'Excessive span drift — fails span-stability.', damageKind: 'drift-fail' },
      { id: 'acme-lc500-lying',    scenarioId: 'lying-twin',  serialNumber: 'LC500-005', sampleName: 'lying-twin',  description: 'Honest physics; dishonest twin (firmware-mapping offset).', damageKind: 'lying-twin' },
      { id: 'acme-lc500-stale',    scenarioId: 'stale-twin',  serialNumber: 'LC500-006', sampleName: 'stale-twin',  description: 'servedAt lags beyond the declared freshness window.', damageKind: 'stale-twin' },
    ],
  },
]

const HBK_MODELS: Model[] = [
  {
    id: 'mdl-hbk-hlci-c6-3300kg',
    designation: 'HBK HLCi',
    manufacturerId: 'mfr-hbk',
    accuracyClass: 'C', classNumber: 6,
    eMaxKg: 3300, nLc: 6000,
    technology: 'digital', construction: 'compression',
    humiditySymbol: 'CH',
    ratedTempDegC: [-10, 40],
    samples: [
      { id: 'hbk-hlci-c6-fresh',  scenarioId: 'hbk-hlci-c6-fresh',  serialNumber: 'HLCi-22A1', sampleName: 'fresh', description: 'Factory-fresh HBK HLCi — passes R 60 across the rated envelope.', damageKind: 'fresh' },
      { id: 'hbk-hlci-c6-aged',   scenarioId: 'hbk-hlci-c6-aged',   serialNumber: 'HLCi-19F07', sampleName: 'aged',  description: '5 years of service — span drift and hysteresis up; passes R 60 but barely.', damageKind: 'aged' },
    ],
  },
  {
    id: 'mdl-hbk-hlci-d1-3300kg',
    designation: 'HBK HLCi (D1)',
    manufacturerId: 'mfr-hbk',
    accuracyClass: 'D', classNumber: 1,
    eMaxKg: 3300, nLc: 1000,
    technology: 'digital', construction: 'compression',
    humiditySymbol: 'CH',
    ratedTempDegC: [-10, 40],
    samples: [
      { id: 'hbk-hlci-d1-fresh', scenarioId: 'hbk-hlci-d1-fresh', serialNumber: 'HLCi-D1-044', sampleName: 'fresh', description: 'Class D1 — coarse accuracy, large MPE. For industrial weighing where tolerance is generous.', damageKind: 'fresh' },
    ],
  },
]

const MTB_MODELS: Model[] = [
  {
    id: 'mdl-mtb-mts-c3-500kg',
    designation: 'Mettler Toledo MTS',
    manufacturerId: 'mfr-mtb',
    accuracyClass: 'C', classNumber: 3,
    eMaxKg: 500, nLc: 3000,
    technology: 'digital', construction: 'compression',
    humiditySymbol: 'CH',
    ratedTempDegC: [-10, 40],
    samples: [
      { id: 'mtb-mts-c3-fresh',  scenarioId: 'mtb-mts-c3-fresh',  serialNumber: 'MTS-A23', sampleName: 'fresh',  description: 'Factory-fresh MTB MTS C3 — passes R 60.', damageKind: 'fresh' },
      { id: 'mtb-mts-c3-dropped', scenarioId: 'mtb-mts-c3-dropped', serialNumber: 'MTS-A19', sampleName: 'dropped', description: 'Dropped in handling — offset shift and non-linearity; fails R 60 linearity.', damageKind: 'dropped' },
    ],
  },
]

const VISHAY_MODELS: Model[] = [
  {
    id: 'mdl-vishay-csh-c6-10t',
    designation: 'Vishay Celtron CSH',
    manufacturerId: 'mfr-vishay',
    accuracyClass: 'C', classNumber: 6,
    eMaxKg: 10000, nLc: 6000,
    technology: 'digital', construction: 'compression',
    humiditySymbol: 'SH',
    ratedTempDegC: [-10, 40],
    samples: [
      { id: 'vishay-csh-c6-fresh',    scenarioId: 'vishay-csh-c6-fresh',    serialNumber: 'CSH-1102', sampleName: 'fresh',    description: 'Factory-fresh Vishay Celtron CSH — passes R 60.', damageKind: 'fresh' },
      { id: 'vishay-csh-c6-corroded', scenarioId: 'vishay-csh-c6-corroded', serialNumber: 'CSH-0458', sampleName: 'corroded', description: 'Corroded (marine environment) — drift and noise up; fails endurance.', damageKind: 'corroded' },
    ],
  },
]

export const CATALOG: Manufacturer[] = [
  { id: 'mfr-acme',   name: 'ACME Instruments',          shortName: 'ACME',  country: 'US', models: ACME_MODELS },
  { id: 'mfr-hbk',    name: 'Hottinger Brüel & Kjaer',    shortName: 'HBK',   country: 'DE', models: HBK_MODELS },
  { id: 'mfr-mtb',    name: 'Mettler Toledo',             shortName: 'MTB',   country: 'CH', models: MTB_MODELS },
  { id: 'mfr-vishay', name: 'Vishay Celtron',             shortName: 'Vishay', country: 'US', models: VISHAY_MODELS },
]

/** Find the catalog entry (manufacturer + model + sample) for a given
 *  scenario id, so the chooser can highlight the current selection. */
export function findInCatalog(scenarioId: string): { manufacturer?: Manufacturer; model?: Model; sample?: Sample } {
  for (const mfr of CATALOG) {
    for (const mdl of mfr.models) {
      for (const s of mdl.samples) {
        if (s.scenarioId === scenarioId) return { manufacturer: mfr, model: mdl, sample: s }
      }
    }
  }
  return {}
}

/** Accuracy-class badge colors (mirrors R 60 hierarchy: A tightest, D coarsest). */
export function classColor(c: AccuracyClass): string {
  switch (c) {
    case 'A': return 'var(--color-ok)'
    case 'B': return 'var(--color-world)'
    case 'C': return 'var(--color-twin)'
    case 'D': return 'var(--color-warn)'
  }
}

/** Damage-kind badge color. */
export function damageColor(d: DamageKind): string {
  if (d === 'fresh') return 'var(--color-ok)'
  if (d === 'lying-twin' || d === 'stale-twin') return 'var(--color-twin)'
  return 'var(--color-err)'
}
