import { describe, it, expect } from 'vitest'
import {
  buildChain,
  totalChainUncertainty,
  toReportBlock,
  buildR60DefaultChain,
  SI_UNIT_LINKS,
  type TraceabilityLink,
} from '../src/certification/traceability.js'
import {
  SI_BASE_UNITS,
  SI_BASE_UNIT_URIS,
  composeUnit,
  dimensionallyConsistent,
  lookupUnit,
  SI_DERIVED_UNITS,
  type UnitsMLUnit,
} from '../src/certification/units.js'
import { formatR602Report } from '../src/certification/r602-report.js'
import { CertificationEngine, type MpeConfig } from '../src/certification/verdict.js'

const KG = SI_BASE_UNITS.kilogram
const KG_URI = SI_BASE_UNIT_URIS.kilogram

const ACME_INSTRUMENT: TraceabilityLink = {
  id: 'acme-lc500-001', level: 'instrument', unit: KG,
  certificate: 'ACME-2024-LC500-001',
  laboratory: 'ACME Instruments', accreditation: 'A2LA 1234.5',
  calibratedAt: '2024-03-15', expiresAt: '2025-03-15',
  uncertaintyK2: 0.05, nextUp: 'acme-working-std',
}
const ACME_WORKING: TraceabilityLink = {
  id: 'acme-working-std', level: 'working', unit: KG,
  certificate: 'ACME-2024-WS-20kg',
  laboratory: 'ACME Instruments', accreditation: 'A2LA 1234.5',
  calibratedAt: '2024-01-10', expiresAt: '2025-01-10',
  uncertaintyK2: 0.005, nextUp: 'ptb-ref-500kg',
}
const PTB_REF: TraceabilityLink = {
  id: 'ptb-ref-500kg', level: 'reference', unit: KG,
  certificate: 'PTB-2023-MASS-500-001',
  laboratory: 'PTB', accreditation: 'DAkkS',
  calibratedAt: '2023-09-01', expiresAt: '2027-09-01',
  uncertaintyK2: 0.0005, nextUp: KG_URI,
}

const KNOWN_LINKS: Record<string, TraceabilityLink> = {
  [ACME_INSTRUMENT.id]: ACME_INSTRUMENT,
  [ACME_WORKING.id]: ACME_WORKING,
  [PTB_REF.id]: PTB_REF,
}

describe('TODO 32 — SI-traceability metadata (BIPM Digital SI Framework + UnitsML)', () => {
  describe('units.ts — the BIPM/UnitsML unit model', () => {
    it('SI_BASE_UNITS exposes all 7 SI base units keyed by canonical BIPM name', () => {
      const keys = Object.keys(SI_BASE_UNITS).sort()
      expect(keys).toEqual(['ampere', 'candela', 'kelvin', 'kilogram', 'metre', 'mole', 'second'])
    })

    it('every SI base unit has a BIPM Digital SI Framework URI', () => {
      for (const u of Object.values(SI_BASE_UNITS)) {
        expect(u.siUri).toMatch(/^https:\/\/si-digital-framework\.org\/SI\/units\//)
        expect(u.quantityKindUri).toMatch(/^https:\/\/si-digital-framework\.org\/SI\/quantities\//)
      }
    })

    it('every SI base unit has zero uncertainty contribution and terminates a chain', () => {
      for (const link of Object.values(SI_UNIT_LINKS)) {
        expect(link.uncertaintyK2).toBe(0)
        expect(link.nextUp).toBeNull()
        expect(link.level).toBe('si_unit')
      }
    })

    it('the kilogram dimension vector is [0,1,0,0,0,0,0] (mass in position 2)', () => {
      expect(KG.dimension).toEqual([0, 1, 0, 0, 0, 0, 0])
      expect(KG.quantityKindUri).toBe('https://si-digital-framework.org/SI/quantities/mass')
    })

    it('composeUnit builds a derived unit with the linear-combination dimension', () => {
      // Newton = kg · m · s⁻² → dim [1, 1, -2, 0, 0, 0, 0]
      const N = SI_DERIVED_UNITS.newton
      expect(N.siUri).toBe('https://si-digital-framework.org/SI/units/newton')
      expect(N.dimension).toEqual([1, 1, -2, 0, 0, 0, 0])
      expect(N.composition).toEqual([
        { unitUri: SI_BASE_UNITS.kilogram.siUri, exponent: 1 },
        { unitUri: SI_BASE_UNITS.metre.siUri, exponent: 1 },
        { unitUri: SI_BASE_UNITS.second.siUri, exponent: -2 },
      ])
    })

    it('dimensionallyConsistent: kg and newton differ in dimension', () => {
      expect(dimensionallyConsistent(KG, SI_DERIVED_UNITS.newton)).toBe(false)
      expect(dimensionallyConsistent(KG, KG)).toBe(true)
    })

    it('lookupUnit resolves base and derived units by BIPM URI', () => {
      expect(lookupUnit(KG_URI)?.siUri).toBe(KG_URI)
      expect(lookupUnit(SI_DERIVED_UNITS.pascal.siUri)?.siUri).toBe(SI_DERIVED_UNITS.pascal.siUri)
      expect(lookupUnit('not-a-uri')).toBeUndefined()
    })

    it('a custom composed unit can be built (e.g., g·m⁻¹ for line density)', () => {
      const lineDensity = composeUnit(
        [
          { unit: SI_BASE_UNITS.kilogram, exponent: 1 },
          { unit: SI_BASE_UNITS.metre, exponent: -1 },
        ],
        'https://example.test/units/line-density',
        'https://si-digital-framework.org/SI/quantities/mass-divided-by-length',
      )
      expect(lineDensity.dimension).toEqual([-1, 1, 0, 0, 0, 0, 0])
      expect(lineDensity.composition?.length).toBe(2)
    })
  })

  describe('traceability.ts — the calibration chain', () => {
    it('buildChain walks nextUp from instrument to the BIPM kilogram', () => {
      const chain = buildChain('acme-lc500-001', KNOWN_LINKS)
      expect(chain.links.map((l) => l.id)).toEqual([
        'acme-lc500-001',
        'acme-working-std',
        'ptb-ref-500kg',
        KG_URI,
      ])
      expect(chain.links[chain.links.length - 1]!.level).toBe('si_unit')
      expect(chain.links[chain.links.length - 1]!.unit.siUri).toBe(KG_URI)
    })

    it('buildChain rejects a cycle', () => {
      const cyclic: Record<string, TraceabilityLink> = {
        a: { id: 'a', level: 'instrument', unit: KG, certificate: 'A', laboratory: 'L', calibratedAt: '2024-01-01', uncertaintyK2: 0.1, nextUp: 'b' },
        b: { id: 'b', level: 'working',     unit: KG, certificate: 'B', laboratory: 'L', calibratedAt: '2024-01-01', uncertaintyK2: 0.1, nextUp: 'a' },
      }
      expect(() => buildChain('a', cyclic)).toThrow(/traceability cycle detected at 'a'/)
    })

    it('buildChain rejects a broken nextUp reference', () => {
      const broken: Record<string, TraceabilityLink> = {
        a: { id: 'a', level: 'instrument', unit: KG, certificate: 'A', laboratory: 'L', calibratedAt: '2024-01-01', uncertaintyK2: 0.1, nextUp: 'nope' },
      }
      expect(() => buildChain('a', broken)).toThrow(/broken link at 'a'/)
    })

    it('buildChain rejects termination in a non-SI unit', () => {
      const deadEnd: Record<string, TraceabilityLink> = {
        a: { id: 'a', level: 'instrument', unit: KG, certificate: 'A', laboratory: 'L', calibratedAt: '2024-01-01', uncertaintyK2: 0.1, nextUp: 'b' },
        b: { id: 'b', level: 'working',     unit: KG, certificate: 'B', laboratory: 'L', calibratedAt: '2024-01-01', uncertaintyK2: 0.1, nextUp: null },
      }
      expect(() => buildChain('a', deadEnd)).toThrow(/terminates in non-SI 'b'/)
    })

    it('buildChain rejects an expired link when `today` is provided', () => {
      expect(() => buildChain('acme-lc500-001', KNOWN_LINKS, '2025-04-01')).toThrow(
        /traceability link 'acme-lc500-001' expired on 2025-03-15/,
      )
    })

    it('buildChain rejects dimensional inconsistency between consecutive links', () => {
      const mixed: Record<string, TraceabilityLink> = {
        inst: { id: 'inst', level: 'instrument', unit: KG, certificate: 'I', laboratory: 'L', calibratedAt: '2024-01-01', uncertaintyK2: 0.1, nextUp: 'thermometer' },
        // A thermometer (kelvin) cannot trace to a kilogram chain.
        thermometer: { id: 'thermometer', level: 'working', unit: SI_BASE_UNITS.kelvin, certificate: 'T', laboratory: 'L', calibratedAt: '2024-01-01', uncertaintyK2: 0.01, nextUp: KG_URI },
      }
      expect(() => buildChain('inst', mixed)).toThrow(/dimensional inconsistency/)
    })

    it('totalChainUncertainty sums each link\'s k=2 uncertainty', () => {
      const chain = buildChain('acme-lc500-001', KNOWN_LINKS)
      expect(totalChainUncertainty(chain)).toBeCloseTo(0.05 + 0.005 + 0.0005, 6)
    })

    it('toReportBlock produces the BIPM-URI-keyed wire shape', () => {
      const chain = buildChain('acme-lc500-001', KNOWN_LINKS)
      const block = toReportBlock(chain)
      expect(block.si_unit_uri).toBe(KG_URI)
      expect(block.links.length).toBe(4)
      expect(block.links[0]!.unit_uri).toBe(KG_URI)
      expect(block.links[0]!.dimension).toEqual([0, 1, 0, 0, 0, 0, 0])
      expect(block.links[0]!.quantity_kind_uri).toBe(KG.quantityKindUri)
      expect(block.links[0]!.accreditation).toBe('A2LA 1234.5')
      expect(block.total_uncertainty_k2).toBeCloseTo(0.0555, 5)
    })

    it('buildR60DefaultChain returns a 4-link chain terminating in the BIPM kilogram', () => {
      const chain = buildR60DefaultChain()
      expect(chain.links.length).toBe(4)
      expect(chain.links[0]!.id).toBe('acme-lc500-001')
      expect(chain.links[3]!.id).toBe(KG_URI)
      expect(chain.links[3]!.unit.siUri).toBe(KG_URI)
    })
  })

  describe('R 60-2 report integration', () => {
    const MPE: MpeConfig = { vMin: 500 / 6000, pLc: 0.7, classes: { C: { bands: [{ intervals: [0, 500], factor: 0.5 }] } } }

    const baseMetadata = {
      manufacturer: 'ACME', model: 'LC-500', serial: '001',
      designation: 'LC-500', nLc: 6000, eMaxKg: 500, eMinKg: 10,
      dKg: 0.05, vMinKg: 0.083, tempRange: '-10…+40', technology: 'strain-gauge',
    }

    it('the R 60-2 report carries the BIPM traceability block', () => {
      const eng = new CertificationEngine('test', 'C', MPE)
      const report = eng.report([eng.probe(0, 40, 40.01)])
      const block = toReportBlock(buildR60DefaultChain())

      const r602 = formatR602Report(report, null, {
        reportNumber: 'R60/2024-SST-TRACE', ...baseMetadata,
      }, block)

      expect(r602.traceability).not.toBeNull()
      expect(r602.traceability!.si_unit_uri).toBe(KG_URI)
      expect(r602.traceability!.links.length).toBe(4)
      expect(r602.traceability!.links[0]!.unit_uri).toBe(KG_URI)
      expect(r602.traceability!.total_uncertainty_k2).toBeGreaterThan(0)
    })

    it('formatR602Report without a chain produces traceability: null', () => {
      const eng = new CertificationEngine('test', 'C', MPE)
      const report = eng.report([eng.probe(0, 40, 40.01)])
      const r602 = formatR602Report(report, null, {
        reportNumber: 'R60/2024-SST-NOTRACE', ...baseMetadata,
      })
      expect(r602.traceability).toBeNull()
    })
  })
})

// keep the unused imports honest — `UnitsMLUnit` is exported for callers.
export type _KeepUnitsMLUnit = UnitsMLUnit
