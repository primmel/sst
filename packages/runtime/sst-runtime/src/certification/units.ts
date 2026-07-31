// units.ts — the BIPM Digital SI Framework + UnitsML unit model.
//
// The SI is modelled per the BIPM Digital SI Framework
// (https://si-digital-framework.org): units are first-class objects
// identified by canonical URIs, with dimensional exponents in the SI
// Brochure v9 order [L, M, T, I, Θ, N, J]. Derived units are composed
// via the UnitsML (NIST UnitsDB) product-of-base-units-with-exponents
// model. SI prefixes are referenced by their BIPM prefix URI.
//
// This is the canonical machine-readable SI model. Naive string tags
// ('kg', 'm/s^2') are NOT used here — they lack dimensional analysis,
// canonical identification, and composability.

/** The 7 SI base dimensions in Brochure v9 order:
 *  [length, mass, time, electric-current, thermodynamic-temperature,
 *   amount-of-substance, luminous-intensity]. */
export type Dimension = [number, number, number, number, number, number, number]

/** A UnitsML-encoded unit: canonical BIPM URI + dimension vector +
 *  quantity kind. Derived units also carry their composition (base unit
 *  URI × exponent pairs). Optional SI prefix (BIPM prefix URI). */
export interface UnitsMLUnit {
  /** The canonical BIPM Digital SI Framework URI for this unit. */
  siUri: string
  /** Dimensional exponents in SI Brochure order [L, M, T, I, Θ, N, J]. */
  dimension: Dimension
  /** The BIPM quantity-kind URI. */
  quantityKindUri: string
  /** For derived units: the base-unit × exponent composition (the
   *  UnitsML product formula). Undefined for the 7 base units. */
  composition?: Array<{ unitUri: string; exponent: number }>
  /** Optional SI prefix (BIPM prefix URI). */
  prefixUri?: string
}

const SI = 'https://si-digital-framework.org/SI' as const

/** The 7 SI base units (BIPM Digital SI Framework). */
export const SI_BASE_UNITS = {
  kilogram: { siUri: `${SI}/units/kilogram`, dimension: [0, 1, 0, 0, 0, 0, 0] as Dimension, quantityKindUri: `${SI}/quantities/mass` },
  metre:    { siUri: `${SI}/units/metre`,    dimension: [1, 0, 0, 0, 0, 0, 0] as Dimension, quantityKindUri: `${SI}/quantities/length` },
  second:   { siUri: `${SI}/units/second`,   dimension: [0, 0, 1, 0, 0, 0, 0] as Dimension, quantityKindUri: `${SI}/quantities/time` },
  ampere:   { siUri: `${SI}/units/ampere`,   dimension: [0, 0, 0, 1, 0, 0, 0] as Dimension, quantityKindUri: `${SI}/quantities/electric-current` },
  kelvin:   { siUri: `${SI}/units/kelvin`,   dimension: [0, 0, 0, 0, 1, 0, 0] as Dimension, quantityKindUri: `${SI}/quantities/thermodynamic-temperature` },
  mole:     { siUri: `${SI}/units/mole`,     dimension: [0, 0, 0, 0, 0, 1, 0] as Dimension, quantityKindUri: `${SI}/quantities/amount-of-substance` },
  candela:  { siUri: `${SI}/units/candela`,  dimension: [0, 0, 0, 0, 0, 0, 1] as Dimension, quantityKindUri: `${SI}/quantities/luminous-intensity` },
} as const satisfies Record<string, UnitsMLUnit>

/** Map from BIPM URI → UnitsMLUnit (for the 7 base units). */
export const SI_BASE_UNIT_BY_URI: Record<string, UnitsMLUnit> = Object.fromEntries(
  Object.values(SI_BASE_UNITS).map((u) => [u.siUri, u]),
)

/** Compose a derived unit from base units × exponents (the UnitsML
 *  product formula). The dimension vector is the linear combination of
 *  the base units' dimensions weighted by their exponents. */
export function composeUnit(
  parts: ReadonlyArray<{ unit: UnitsMLUnit; exponent: number }>,
  siUri: string,
  quantityKindUri: string,
  prefixUri?: string,
): UnitsMLUnit {
  const dim: Dimension = [0, 0, 0, 0, 0, 0, 0]
  const composition: Array<{ unitUri: string; exponent: number }> = []
  for (const { unit, exponent } of parts) {
    for (let i = 0; i < 7; i++) dim[i]! += unit.dimension[i]! * exponent
    composition.push({ unitUri: unit.siUri, exponent })
  }
  return { siUri, dimension: dim, quantityKindUri, composition, ...(prefixUri ? { prefixUri } : {}) }
}

/** Common SI derived units (UnitsML-composed from base units). */
export const SI_DERIVED_UNITS = {
  newton: composeUnit(
    [
      { unit: SI_BASE_UNITS.kilogram, exponent: 1 },
      { unit: SI_BASE_UNITS.metre, exponent: 1 },
      { unit: SI_BASE_UNITS.second, exponent: -2 },
    ],
    `${SI}/units/newton`, `${SI}/quantities/force`,
  ),
  pascal: composeUnit(
    [
      { unit: SI_BASE_UNITS.kilogram, exponent: 1 },
      { unit: SI_BASE_UNITS.metre, exponent: -1 },
      { unit: SI_BASE_UNITS.second, exponent: -2 },
    ],
    `${SI}/units/pascal`, `${SI}/quantities/pressure`,
  ),
  joule: composeUnit(
    [
      { unit: SI_BASE_UNITS.kilogram, exponent: 1 },
      { unit: SI_BASE_UNITS.metre, exponent: 2 },
      { unit: SI_BASE_UNITS.second, exponent: -2 },
    ],
    `${SI}/units/joule`, `${SI}/quantities/energy`,
  ),
  watt: composeUnit(
    [
      { unit: SI_BASE_UNITS.kilogram, exponent: 1 },
      { unit: SI_BASE_UNITS.metre, exponent: 2 },
      { unit: SI_BASE_UNITS.second, exponent: -3 },
    ],
    `${SI}/units/watt`, `${SI}/quantities/power`,
  ),
} as const satisfies Record<string, UnitsMLUnit>

/** Map from BIPM URI → UnitsMLUnit (base + derived). */
export const ALL_UNITS_BY_URI: Record<string, UnitsMLUnit> = {
  ...SI_BASE_UNIT_BY_URI,
  ...Object.fromEntries(Object.values(SI_DERIVED_UNITS).map((u) => [u.siUri, u])),
}

/** True if two units have the same dimension vector (UnitsML
 *  dimensional consistency). The BIPM framework requires that a
 *  calibration chain links standards of the same quantity kind. */
export function dimensionallyConsistent(a: UnitsMLUnit, b: UnitsMLUnit): boolean {
  for (let i = 0; i < 7; i++) {
    if (a.dimension[i] !== b.dimension[i]) return false
  }
  return true
}

/** Look up a unit by its BIPM URI (base or derived). */
export function lookupUnit(uri: string): UnitsMLUnit | undefined {
  return ALL_UNITS_BY_URI[uri]
}

/** The BIPM SI base unit URIs (for convenience in tests and reports). */
export const SI_BASE_UNIT_URIS = {
  kilogram: SI_BASE_UNITS.kilogram.siUri,
  metre: SI_BASE_UNITS.metre.siUri,
  second: SI_BASE_UNITS.second.siUri,
  ampere: SI_BASE_UNITS.ampere.siUri,
  kelvin: SI_BASE_UNITS.kelvin.siUri,
  mole: SI_BASE_UNITS.mole.siUri,
  candela: SI_BASE_UNITS.candela.siUri,
} as const
