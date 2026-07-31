// twin/projection.ts — the type-enforced epistemic wall.
//
// The first law: "Nothing from /world may leak into /twin." Today
// enforced by topology (two endpoints). This module enforces it at
// the TypeScript level: the /twin schema's resolvers receive a
// TwinView — a concrete interface that exposes ONLY the instrument's
// legal-view methods, with no path to ground truth.

/** The legal view of an instrument — what /twin may read.
 *  This is a CONCRETE interface (not generic). It has exactly four
 *  methods. It has NO groundTruth, NO placeMass — the type system
 *  refuses any such call on a TwinView value. */
export interface TwinView {
  indication(): unknown
  servedAt(): number
  operationalState(): string
  environment(): unknown
}

/** Project an instrument to its legal view. Runtime no-op; type narrows
 *  to TwinView. After this call, the TypeScript compiler refuses any
 *  access to groundTruth() or other /world-only methods. */
export function projectToTwinView<I>(instrument: I & {
  indication(...a: never[]): unknown
  servedAt(...a: never[]): unknown
  operationalState(...a: never[]): unknown
  environment(...a: never[]): unknown
}): TwinView {
  return instrument as TwinView
}

/** Type-level check: TwinView does NOT expose `groundTruth`. */
export type EpistemicWallHolds = TwinView extends { groundTruth: unknown } ? false : true
