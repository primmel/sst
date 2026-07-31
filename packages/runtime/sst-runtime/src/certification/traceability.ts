// certification/traceability.ts — the SI-traceability metadata layer.
//
// Every certified measurement must trace back to the SI unit through an
// unbroken calibration chain (VIM §2.42 metrological traceability). The
// chain is:
//
//   instrument  →  reference standard  →  national standard  →  SI unit
//
// Each link carries: the calibration certificate, the laboratory that
// issued it, the calibration date, the uncertainty contributed at that
// link, the SI unit it realises (modelled per the BIPM Digital SI
// Framework + UnitsML — see units.ts), and the next link up.
//
// buildChain() walks the nextUp pointers from a starting link until
// reaching an SI base unit, validating at each step:
//   - no missing nextUp references (broken chain)
//   - no cycles
//   - dimensional consistency between consecutive links (UnitsML)
//   - no expired links (when `today` is provided)
//   - termination in an SI base unit (not a working standard)
//
// This makes SI-traceability a first-class, machine-verifiable property
// of the simulated certification infrastructure — not a paper artifact.

import {
  SI_BASE_UNITS,
  SI_BASE_UNIT_BY_URI,
  dimensionallyConsistent,
  type UnitsMLUnit,
} from './units.js'

/** A single link in the calibration chain. */
export interface TraceabilityLink {
  /** What this link IS — the artifact, standard, or unit. */
  id: string
  /** The class of standard: 'si_unit' | 'primary' | 'secondary' | 'reference' | 'working' | 'instrument'. */
  level: 'si_unit' | 'primary' | 'secondary' | 'reference' | 'working' | 'instrument'
  /** The SI unit this link realises (BIPM URI + UnitsML dimension + quantity kind). */
  unit: UnitsMLUnit
  /** The calibration certificate that establishes the link to the next-up. */
  certificate: string
  /** The laboratory that issued the certificate (NMI, accredited lab, …). */
  laboratory: string
  /** ISO 17025 accreditation body (DAkkS, UKAS, A2LA, …) — empty for NMIs. */
  accreditation?: string
  /** When the calibration was performed (ISO 8601 date). */
  calibratedAt: string
  /** When the calibration expires (ISO 8601 date) — null for SI units. */
  expiresAt?: string | null
  /** The uncertainty (k=2, in the link's unit) contributed at this link.
   *  SI units contribute zero. */
  uncertaintyK2: number
  /** The id of the next link up (the standard this one was calibrated
   *  against). Null only for SI base units. */
  nextUp: string | null
}

/** A validated calibration chain. */
export interface TraceabilityChain {
  links: TraceabilityLink[]
}

/** The canonical SI-base-unit termini (one TraceabilityLink per base
 *  unit). Each has zero uncertainty, calibrated by BIPM, realises
 *  itself. These are the only valid chain termini. */
export const SI_UNIT_LINKS: Record<string, TraceabilityLink> = Object.fromEntries(
  Object.values(SI_BASE_UNITS).map((u) => [
    u.siUri,
    {
      id: u.siUri,
      level: 'si_unit' as const,
      unit: u,
      certificate: 'BIPM-SI-Brochure-9',
      laboratory: 'BIPM',
      calibratedAt: '2019-05-20',
      uncertaintyK2: 0,
      nextUp: null,
    } satisfies TraceabilityLink,
  ]),
)

/** Build a TraceabilityChain by walking nextUp pointers from a starting
 *  link until reaching an SI base unit. Throws on:
 *  - missing nextUp references (a broken chain)
 *  - cycles
 *  - dimensional inconsistency between consecutive links
 *  - expiry of any non-SI link (if `today` is provided)
 *  - termination in something other than an SI base unit */
export function buildChain(
  startId: string,
  knownLinks: Record<string, TraceabilityLink>,
  today?: string,
): TraceabilityChain {
  const chain: TraceabilityLink[] = []
  const visited = new Set<string>()
  let cursor: TraceabilityLink | undefined = lookupLink(startId, knownLinks)
  while (cursor) {
    if (visited.has(cursor.id)) {
      throw new Error(`traceability cycle detected at '${cursor.id}'`)
    }
    visited.add(cursor.id)
    if (today && cursor.expiresAt && cursor.expiresAt < today) {
      throw new Error(`traceability link '${cursor.id}' expired on ${cursor.expiresAt} (today is ${today})`)
    }
    chain.push(cursor)
    if (cursor.nextUp === null) {
      if (cursor.level !== 'si_unit') {
        throw new Error(`traceability chain terminates in non-SI '${cursor.id}' (level: ${cursor.level})`)
      }
      return { links: chain }
    }
    const next = lookupLink(cursor.nextUp, knownLinks)
    if (!next) {
      throw new Error(`traceability chain has a broken link at '${cursor.id}' (nextUp '${cursor.nextUp}' not found)`)
    }
    if (!dimensionallyConsistent(cursor.unit, next.unit)) {
      throw new Error(
        `traceability dimensional inconsistency: '${cursor.id}' has dimension ` +
        `[${cursor.unit.dimension.join(',')}] but next-up '${next.id}' has ` +
        `[${next.unit.dimension.join(',')}] — a calibration chain must link ` +
        `standards of the same quantity kind (BIPM Digital SI Framework)`,
      )
    }
    cursor = next
  }
  // Unreachable: the loop returns when nextUp === null, or throws when
  // next is undefined. Here for exhaustiveness.
  throw new Error(`traceability chain truncated unexpectedly at '${startId}'`)
}

function lookupLink(id: string, known: Record<string, TraceabilityLink>): TraceabilityLink | undefined {
  return known[id] ?? SI_UNIT_LINKS[id] ?? (SI_BASE_UNIT_BY_URI[id] ? SI_UNIT_LINKS[id] : undefined)
}

/** Sum the uncertainties (k=2) along a chain. For independent links this
 *  is an upper bound (the actual combined uncertainty uses RSS — see
 *  UncertaintyBudget). The sum is a conservative estimate suitable for
 *  metadata display, not for conformance verdicts. */
export function totalChainUncertainty(chain: TraceabilityChain): number {
  return chain.links.reduce((sum, l) => sum + l.uncertaintyK2, 0)
}

/** The R 60-2 report's traceability block (the structure that goes into
 *  formatR602Report). Carries BIPM URIs and UnitsML dimensions verbatim. */
export interface TraceabilityReportBlock {
  /** The BIPM URI of the SI base unit this chain terminates in. */
  si_unit_uri: string
  links: Array<{
    id: string
    level: string
    /** The BIPM URI of this link's unit. */
    unit_uri: string
    /** The UnitsML dimension vector [L, M, T, I, Θ, N, J]. */
    dimension: readonly number[]
    /** The BIPM quantity-kind URI. */
    quantity_kind_uri: string
    certificate: string
    laboratory: string
    accreditation: string
    calibrated_at: string
    expires_at: string | null
    uncertainty_k2: number
  }>
  total_uncertainty_k2: number
}

export function toReportBlock(chain: TraceabilityChain): TraceabilityReportBlock {
  const terminus = chain.links[chain.links.length - 1]!
  if (terminus.level !== 'si_unit') {
    throw new Error(`toReportBlock: chain does not terminate in an SI unit (got level '${terminus.level}')`)
  }
  return {
    si_unit_uri: terminus.id,
    links: chain.links.map((l) => ({
      id: l.id,
      level: l.level,
      unit_uri: l.unit.siUri,
      dimension: l.unit.dimension,
      quantity_kind_uri: l.unit.quantityKindUri,
      certificate: l.certificate,
      laboratory: l.laboratory,
      accreditation: l.accreditation ?? '',
      calibrated_at: l.calibratedAt,
      expires_at: l.expiresAt ?? null,
      uncertainty_k2: l.uncertaintyK2,
    })),
    total_uncertainty_k2: totalChainUncertainty(chain),
  }
}

/** Build the canonical R 60 LC-500 calibration chain: instrument →
 *  working standard → reference standard (NMI) → BIPM kilogram.
 *  Every link realises the kilogram (dimension [0,1,0,0,0,0,0]).
 *  Useful as a default for tests and the canonical demo. */
export function buildR60DefaultChain(): TraceabilityChain {
  const kg = SI_BASE_UNITS.kilogram
  const kgUri = kg.siUri
  const links: Record<string, TraceabilityLink> = {
    'acme-lc500-001': {
      id: 'acme-lc500-001', level: 'instrument', unit: kg,
      certificate: 'ACME-2024-LC500-001',
      laboratory: 'ACME Instruments (in-house)', accreditation: 'A2LA 1234.5',
      calibratedAt: '2024-03-15', expiresAt: '2025-03-15',
      uncertaintyK2: 0.050, nextUp: 'acme-working-std',
    },
    'acme-working-std': {
      id: 'acme-working-std', level: 'working', unit: kg,
      certificate: 'ACME-2024-WS-20kg',
      laboratory: 'ACME Instruments (in-house)', accreditation: 'A2LA 1234.5',
      calibratedAt: '2024-01-10', expiresAt: '2025-01-10',
      uncertaintyK2: 0.005, nextUp: 'ptb-ref-500kg',
    },
    'ptb-ref-500kg': {
      id: 'ptb-ref-500kg', level: 'reference', unit: kg,
      certificate: 'PTB-2023-MASS-500-001',
      laboratory: 'PTB (Physikalisch-Technische Bundesanstalt)', accreditation: 'DAkkS',
      calibratedAt: '2023-09-01', expiresAt: '2027-09-01',
      uncertaintyK2: 0.0005, nextUp: kgUri,
    },
  }
  return buildChain('acme-lc500-001', links)
}
