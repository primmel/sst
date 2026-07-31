// certification/cnml-export.ts — export an R 60-2 test report as a
// CNML (Certificat Numérique de Métrologie Légale) pre-signing JSON
// document. The output is consumed by the digital-certificates repo
// (~/src/oimlsmart/digital-certificates/) which signs it with XMLDSig
// and issues the final machine-verifiable certificate.
//
// The CNML bridge: sim-instruments produces the test data (conformance
// + uncertainty + traceability); digital-certificates provides the PKI
// (signing, verification, CRL, timestamps). Together they form a
// complete digital certification infrastructure for OIML instruments.

import type { R602Report } from './r602-report.js'
import type { InstrumentModel } from '../twin-contract.js'
import type { TraceabilityReportBlock } from './traceability.js'

/** The CNML pre-signing JSON shape — matches the R 60 CNML schema in
 *  digital-certificates/packages/cnml-schemas/schemas/R60.yaml.
 *  This is the UNSIGNED certificate; the digital-certificates repo
 *  adds the XMLDSig signature block. */
export interface CnmlCertificate {
  '@context': string[]
  '@type': 'OIMLCertificate'
  '@id': string
  certificate_number: string
  certificate_type: string
  status: 'draft' | 'issued' | 'revoked'
  issued_at: string
  recommendation: {
    id: string
    edition: string
  }
  issuing_authority: {
    name: string
    scope: string
  }
  applicant: {
    manufacturer: string
    model: string
    serial: string
    designation: string
    country?: string | undefined
  }
  instrument_identification: {
    designation: string
    accuracy_class: string
    n_lc: number
    e_max_kg: number
    e_min_kg: number
    d_kg: number
    v_min_kg: number
    technology: string
    rated_temp_range: string
  }
  test_results: Array<{
    test_name: string
    probes: Array<{
      load_kg: number
      indication_kg: number
      error_kg: number
      mpe_kg: number
      verdict: string
    }>
    overall_verdict: string
  }>
  uncertainty: {
    type_a_u: number
    type_b_components: number
    combined_u: number
    expanded_u_k2: number
    confidence: string
  } | null
  traceability: {
    si_unit_uri: string
    links: Array<{
      id: string
      level: string
      certificate: string
      laboratory: string
      uncertainty_k2: number
    }>
    total_uncertainty_k2: number
  } | null
  overall_verdict: 'pass' | 'fail'
}

/** Export an R 60-2 test report + instrument model + traceability
 *  chain as a CNML pre-signing JSON document. The digital-certificates
 *  repo signs this with XMLDSig to produce the final certificate. */
export function exportToCnml(
  report: R602Report,
  model: InstrumentModel,
  traceability: TraceabilityReportBlock | null,
  metadata: {
    certificateNumber: string
    issuingAuthority: string
    scope?: string
  },
): CnmlCertificate {
  const ident = model.identification
  const classification = model.classification as Record<string, string | number | undefined> | undefined
  const dp = model.designParameters as Record<string, { value: number; unit: string }> | undefined

  return {
    '@context': [
      'https://www.w3.org/2018/credentials/v1',
      'https://oiml.org/cnml/v1',
    ],
    '@type': 'OIMLCertificate',
    '@id': `urn:oiml:cnml:${metadata.certificateNumber}`,
    certificate_number: metadata.certificateNumber,
    certificate_type: 'oiml-r60-type-approval',
    status: 'draft',
    issued_at: report.report_header.report_date,
    recommendation: {
      id: ident.oimlRecommendation ?? 'OIML R 60',
      edition: report.report_header.edition,
    },
    issuing_authority: {
      name: metadata.issuingAuthority,
      scope: metadata.scope ?? 'OIML R 60 load cells',
    },
    applicant: {
      manufacturer: ident.manufacturer ?? 'unknown',
      model: ident.model ?? 'unknown',
      serial: ident.serial ?? 'unknown',
      designation: ident.designation ?? 'unknown',
    },
    instrument_identification: {
      designation: report.instrument_identification.designation,
      accuracy_class: report.instrument_identification.accuracy_class,
      n_lc: report.instrument_identification.n_lc,
      e_max_kg: report.instrument_identification.e_max_kg,
      e_min_kg: report.instrument_identification.e_min_kg,
      d_kg: report.instrument_identification.d_kg,
      v_min_kg: report.instrument_identification.v_min_kg,
      technology: report.instrument_identification.technology,
      rated_temp_range: report.instrument_identification.rated_temp_range,
    },
    test_results: report.test_results,
    uncertainty: report.uncertainty,
    traceability: traceability ? {
      si_unit_uri: traceability.si_unit_uri,
      links: traceability.links,
      total_uncertainty_k2: traceability.total_uncertainty_k2,
    } : null,
    overall_verdict: report.overall_verdict,
  }
}
