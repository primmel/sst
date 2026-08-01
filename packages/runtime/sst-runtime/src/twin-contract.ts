// twin-contract.ts — the normalized serve contract (spec §6): the
// shape the twin schema generates from. Deliberately primmel-free —
// the .prl adapter (twin-contract-prl.ts, build-time) produces this.
//
// The contract is generic over its serves + operations tuple types so
// the typed TwinDriver<C> can derive literal method signatures via
// TypeScript mapped types. Callers that don't care about the typed
// driver use the default type params (the widest shape).
//
// The contract also carries the FULL InstrumentModel (identification,
// classification, designParameters, metrologicalLimits, provenance) —
// the digital twin mirrors the Recommendation's full instrument model,
// not just its served-register leaves. The schema generator produces
// nested GraphQL types from this model.

/** A typed quantity — value + BIPM Digital SI Framework unit URI.
 *  Per the SI-traceability memory, never an ad-hoc slug. */
export interface ModelQuantity {
  value: number
  /** BIPM Digital SI Framework URI (e.g. 'https://si-digital-framework.org/SI/units/kilogram'). */
  unit: string
}

/** Identification block — who the instrument is. */
export interface InstrumentIdentification {
  instrumentId: string
  kindId?: string | undefined
  oimlRecommendation?: string | undefined
  manufacturer?: string | undefined
  model?: string | undefined
  serial?: string | undefined
  designation?: string | undefined
}

/** Classification axes — kind-specific. R 60 uses accuracy_class,
 *  humidity_class, load_type, construction, technology, n_lc. Other
 *  kinds declare their own axes here. */
export interface Classification {
  [axis: string]: string | number | undefined
}

/** Design parameters — the Recommendation's characteristic parameters
 *  (e.g. R 60-1 §4: e_max, e_min, v_min, n_lc, d_r, rated output).
 *  Each value is a typed ModelQuantity. */
export interface DesignParameters {
  [param: string]: ModelQuantity | undefined
}

/** One MPE band: a half-open interval [lower, upper] with a factor
 *  applied to v_min. R 60-1 Table 3. */
export interface MpeBand {
  lower: number
  /** Upper bound; Number.POSITIVE_INFINITY for the top band. */
  upper: number
  factor: number
}

/** Metrological limits — the Recommendation's governed limits
 *  (R 60-1 §5: MPE, repeatability, creep, temperature effects). */
export interface MetrologicalLimits {
  mpeBands?: MpeBand[]
  repeatability?: number
  creepAllowance?: number
  temperatureEffectOnSpan?: number
  temperatureEffectOnZero?: number
}

/** Calibration / certification provenance. */
export interface Provenance {
  certificate?: string
  firstIssued?: string
}

/** The full instrument model — the Recommendation's instrument in
 *  digital form. The digital twin's GraphQL schema mirrors this
 *  hierarchy; the served registers and legal operations are leaves. */
export interface InstrumentModel {
  identification: InstrumentIdentification
  classification?: Classification | undefined
  designParameters?: DesignParameters | undefined
  metrologicalLimits?: MetrologicalLimits | undefined
  provenance?: Provenance | undefined
}

export interface ServeDeclaration {
  /** the served register id: 'indication' | 'state' | 'environmental_context' | … */
  target: string
  /** the serving operation id: 'get_indication' | 'watch_state' | … */
  via: string
  /** freshness bound in seconds (fresh_within). */
  freshWithinS?: number
}

export interface TwinOperation {
  /** instrument-legal operation id: 'zero_setting' | 'self_test' | … */
  id: string
  kind: 'query' | 'watch' | 'command'
}

export interface TwinContract<
  Serves extends readonly ServeDeclaration[] = readonly ServeDeclaration[],
  Operations extends readonly TwinOperation[] = readonly TwinOperation[],
> {
  instrumentId: string
  serves: Serves
  operations: Operations
  /** The full instrument model — when present, the schema generator
   *  emits nested GraphQL types mirroring the model and exposes them
   *  via `Query.instrument`. Optional for backward compatibility with
   *  contracts that haven't been enriched yet. */
  model?: InstrumentModel
}

/** The LC-500 contract — what the .prl adapter parses to. Carries
 *  instrumentId + serves + operations only (these are what the .prl
 *  declares). The full instrument model lives in LC500_FULL_MODEL
 *  (the Recommendation's full instrument hierarchy, sourced from the
 *  instance package manifest) and is combined at boot time before
 *  generateTwinSchema runs.
 *
 *  Declared `as const satisfies TwinContract` so the literal tuple
 *  types flow into TwinDriver<typeof LC500_CONTRACT> for compile-time
 *  method checking. The handshake test (twin-bake.test.ts) asserts
 *  the real acme-lc500.prl parses to exactly this fixture. */
export const LC500_CONTRACT = {
  instrumentId: 'acme-lc500',
  serves: [
    { target: 'indication', via: 'get_indication', freshWithinS: 5 },
    { target: 'state', via: 'watch_state', freshWithinS: 1 },
  ],
  operations: [
    { id: 'get_indication', kind: 'query' },
    { id: 'watch_state', kind: 'watch' },
    { id: 'run_self_test', kind: 'command' },
  ],
} as const satisfies TwinContract

/** The LC-500's full R 60 instrument model — the digital twin mirrors
 *  the Recommendation's full instrument hierarchy (identification,
 *  classification, design parameters, metrological limits, provenance).
 *  Sourced from the instance package's manifest; combined with
 *  LC500_CONTRACT at boot time. Per the BIPM/UnitsML rule, all units
 *  are canonical BIPM Digital SI Framework URIs.
 *
 *  Declared `as const satisfies InstrumentModel` so the literal types
 *  flow into TwinDriver<typeof enriched>.instrument() — the typed
 *  response carries the specific field shapes. */
export const LC500_FULL_MODEL = {
  identification: {
    instrumentId: 'acme-lc500',
    kindId: 'primmel-sst-r60',
    oimlRecommendation: 'OIML R 60',
    manufacturer: 'ACME Instruments',
    model: 'LC-500',
    designation: 'ACME LC-500 class C6 load cell',
  },
  classification: {
    accuracy_class: 'C',
    class_number: 6,
    n_lc: 6000,
    humidity_class: 'CH',
    load_type: 'universal',
    construction: 'column',
    technology: 'strain-gauge',
  },
  designParameters: {
    e_max:        { value: 500,    unit: 'https://si-digital-framework.org/SI/units/kilogram' },
    e_min:        { value: 10,     unit: 'https://si-digital-framework.org/SI/units/kilogram' },
    v_min:        { value: 0.0833, unit: 'https://si-digital-framework.org/SI/units/kilogram' },
    d_r:          { value: 0.05,   unit: 'https://si-digital-framework.org/SI/units/kilogram' },
    t_min:        { value: -10,    unit: 'https://si-digital-framework.org/SI/units/kelvin' },
    t_max:        { value: 40,     unit: 'https://si-digital-framework.org/SI/units/kelvin' },
    rated_output: { value: 2.0,    unit: 'https://si-digital-framework.org/SI/units/millivolt-per-volt' },
  },
  metrologicalLimits: {
    // R 60-1 Table 3 — class C: 0.5 v_min on [0, E_max].
    mpeBands: [{ lower: 0, upper: Number.POSITIVE_INFINITY, factor: 0.5 }],
    creepAllowance: 0.7,    // p_lc × MPE
  },
  provenance: {
    certificate: 'R60/2021-DE-24-071',
    firstIssued: '2021-04-15',
  },
} as const satisfies InstrumentModel

/** Combine the .prl-parsed contract with the full model — used at boot
 *  time to produce the enriched contract that generateTwinSchema turns
 *  into the model-mirroring schema. The model type is preserved on the
 *  return type so TwinDriver<typeof enriched> can derive the typed
 *  instrument() method. */
export function withModel<C extends TwinContract, M extends InstrumentModel>(
  contract: C,
  model: M,
): C & { model: M } {
  return { ...contract, model }
}

/** The CGM-200 contract — what the .prl adapter parses to. Carries
 *  instrumentId + serves + operations only. The full R 144 model lives
 *  in GAS_ANALYZER_FULL_MODEL. The package is the SSOT — this fixture
 *  mirrors it for the package-less standalone posture, and the .prl
 *  adapter handshake test (gas-twin.test.ts) asserts the real package
 *  parses to exactly this (the LC500_CONTRACT precedent). */
export const GAS_ANALYZER_CONTRACT = {
  instrumentId: 'acme-cgm-200',
  serves: [
    { target: 'indication_co', via: 'get_indication_co', freshWithinS: 5 },
    { target: 'indication_nox', via: 'get_indication_nox', freshWithinS: 5 },
    { target: 'state', via: 'watch_op_state', freshWithinS: 1 },
    { target: 'environmental_context', via: 'watch_op_state', freshWithinS: 1 },
  ],
  operations: [
    { id: 'get_indication_co', kind: 'query' },
    { id: 'get_indication_nox', kind: 'query' },
    { id: 'watch_op_state', kind: 'watch' },
    { id: 'zero_calibration', kind: 'command' },
    { id: 'span_calibration', kind: 'command' },
    { id: 'run_self_check', kind: 'command' },
  ],
} as const satisfies TwinContract

/** The CGM-200's full R 144 instrument model. See LC500_FULL_MODEL
 *  for the rationale (manifest-sourced; combined at boot). */
export const GAS_ANALYZER_FULL_MODEL = {
  identification: {
    instrumentId: 'acme-cgm-200',
    kindId: 'primmel-sst-r144',
    oimlRecommendation: 'OIML R 144',
    manufacturer: 'ACME Instruments',
    model: 'CGM-200',
    designation: 'ACME CGM-200 continuous gas monitor',
  },
  classification: {
    measured_components: 'CO, NOx',
    measurement_principle_co: 'NDIR',
    measurement_principle_nox: 'CLD',
  },
  provenance: {
    certificate: 'R144/2022-DE-08-013',
    firstIssued: '2022-02-10',
  },
} as const satisfies InstrumentModel

/** The RS-180 contract — R 91 (Doppler radar speed meter). Sourced from
 *  the baked artifact at packages/kinds/sst-r91/twin/r91.twin.json. Declared
 *  `as const satisfies TwinContract` for the typed TwinDriver. */
export const RS180_CONTRACT = {
  instrumentId: 'acme-rs180',
  serves: [
    { target: 'indication', via: 'get_indication', freshWithinS: 1 },
    { target: 'state', via: 'watch_state', freshWithinS: 1 },
    { target: 'environmental_context', via: 'watch_state', freshWithinS: 1 },
  ],
  operations: [
    { id: 'get_indication', kind: 'query' },
    { id: 'watch_state', kind: 'watch' },
    { id: 'run_self_test', kind: 'command' },
  ],
} as const satisfies TwinContract

export const RS180_FULL_MODEL = {
  identification: {
    instrumentId: 'acme-rs180',
    kindId: 'primmel-sst-r91',
    oimlRecommendation: 'OIML R 91',
    manufacturer: 'ACME Instruments',
    model: 'RS-180',
    designation: 'ACME RS-180 stationary K-band radar speed meter',
  },
  classification: {
    measurement_principle: 'Doppler radar',
    frequency_band: 'K-band',
    speed_range_kmh: '20–250',
  },
} as const satisfies InstrumentModel

/** The MD-3xx contract — R 129 (optical multi-dimensional measuring
 *  instrument). Sourced from packages/kinds/sst-r129/twin/r129.twin.json. */
export const MD3XX_CONTRACT = {
  instrumentId: 'acme-md3xx',
  serves: [
    { target: 'indication_length', via: 'get_dimensions', freshWithinS: 2 },
    { target: 'indication_width', via: 'get_dimensions', freshWithinS: 2 },
    { target: 'indication_height', via: 'get_dimensions', freshWithinS: 2 },
    { target: 'dim_volume', via: 'get_volume', freshWithinS: 2 },
    { target: 'dim_weight', via: 'get_dim_weight', freshWithinS: 2 },
    { target: 'state', via: 'watch_state', freshWithinS: 1 },
    { target: 'environmental_context', via: 'watch_state', freshWithinS: 1 },
  ],
  operations: [
    { id: 'get_dimensions', kind: 'query' },
    { id: 'get_volume', kind: 'query' },
    { id: 'get_dim_weight', kind: 'query' },
    { id: 'watch_state', kind: 'watch' },
    { id: 'run_self_test', kind: 'command' },
  ],
} as const satisfies TwinContract

export const MD3XX_FULL_MODEL = {
  identification: {
    instrumentId: 'acme-md3xx',
    kindId: 'primmel-sst-r129',
    oimlRecommendation: 'OIML R 129',
    manufacturer: 'ACME Instruments',
    model: 'MD-300',
    designation: 'ACME MD-300 multi-dimensional measuring instrument',
  },
  classification: {
    measurement_principle: 'light-section scanning',
    instrument_category: 'automatic',
  },
} as const satisfies InstrumentModel
