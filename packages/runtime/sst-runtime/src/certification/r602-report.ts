// certification/r602-report.ts — the OIML R 60-2 standardised test report
// formatter. Takes the CertificationEngine's TestReport and formats it
// per the R 60-2 test report format — the structured document that OIML
// certification infrastructure expects.

import type { TestReport, ProbeResult } from './verdict.js'
import type { UncertaintyBudget } from './uncertainty.js'
import type { TraceabilityReportBlock } from './traceability.js'

/** The R 60-2 standardised test report shape. */
export interface R602Report {
  report_header: {
    report_number: string
    report_date: string
    recommendation: string          // 'oiml-r60'
    edition: string                 // '2017'
    laboratory: {
      name: string
      authority: string
    }
    applicant: {
      manufacturer: string
      model: string
      serial: string
    }
  }
  instrument_identification: {
    designation: string
    accuracy_class: string
    n_lc: number
    e_max_kg: number
    e_min_kg: number
    d_kg: number
    v_min_kg: number
    rated_temp_range: string
    technology: string
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
  /** The SI-traceability chain (VIM §2.42). Optional — present when the
   *  kind/instance package ships a traceability.yaml or the caller
   *  builds one programmatically. Null = no chain supplied. */
  traceability: TraceabilityReportBlock | null
  overall_verdict: 'pass' | 'fail'
}

/** Format a TestReport + optional uncertainty budget into the R 60-2
 *  standardised report shape. */
export function formatR602Report(
  testReport: TestReport,
  uncertainty: ReturnType<UncertaintyBudget['report']> | null,
  metadata: {
    reportNumber: string
    manufacturer: string
    model: string
    serial: string
    designation: string
    nLc: number
    eMaxKg: number
    eMinKg: number
    dKg: number
    vMinKg: number
    tempRange: string
    technology: string
  },
  traceability: TraceabilityReportBlock | null = null,
): R602Report {
  return {
    report_header: {
      report_number: metadata.reportNumber,
      report_date: new Date().toISOString().split('T')[0]!,
      recommendation: 'oiml-r60',
      edition: '2017',
      laboratory: { name: 'Primmel SST Simulator', authority: 'SST-CERT' },
      applicant: {
        manufacturer: metadata.manufacturer,
        model: metadata.model,
        serial: metadata.serial,
      },
    },
    instrument_identification: {
      designation: metadata.designation,
      accuracy_class: testReport.accuracyClass,
      n_lc: metadata.nLc,
      e_max_kg: metadata.eMaxKg,
      e_min_kg: metadata.eMinKg,
      d_kg: metadata.dKg,
      v_min_kg: metadata.vMinKg,
      rated_temp_range: metadata.tempRange,
      technology: metadata.technology,
    },
    test_results: [{
      test_name: 'MPE compliance',
      probes: testReport.probes.map(formatProbe),
      overall_verdict: testReport.overall,
    }],
    uncertainty: uncertainty ? {
      type_a_u: uncertainty.typeA.u,
      type_b_components: uncertainty.typeB.length,
      combined_u: uncertainty.combined,
      expanded_u_k2: uncertainty.expanded,
      confidence: uncertainty.confidence,
    } : null,
    traceability,
    overall_verdict: testReport.overall,
  }
}

function formatProbe(p: ProbeResult): {
  load_kg: number; indication_kg: number; error_kg: number; mpe_kg: number; verdict: string
} {
  return {
    load_kg: p.loadKg,
    indication_kg: p.indicationKg,
    error_kg: p.errorKg,
    mpe_kg: p.mpeKg,
    verdict: p.verdict,
  }
}
