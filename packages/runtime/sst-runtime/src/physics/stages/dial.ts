// dial.ts — the analogue-passive indicator pairing (spec §14, smart
// TODO.v2/09): a passive dial indicator rendering the SAME ground truth
// the digital stack quantizes and serves. A passive indicator has no
// twin interface — the dial is a RENDERING of reality, never a served
// value: no /twin serve, no /world knob. The reading enters evidence
// through a human observer at the dial's declared uncertainty. Pure
// and deterministic — nothing here rides the seeded RNG (no
// parallax/flicker model in v1).
import type { Unit } from '../quantity.js'

/** The dial specification — range, graduation interval, unit. Declared
 *  once per instrument/bench configuration; the model
 *  (pointerPositionKg) and the bench renderer both consume it. */
export interface DialSpec {
  /** full-scale range: the pointer sweeps 0…capacity. */
  capacityKg: number
  /** the graduation interval — the smallest scale division. */
  graduationKg: number
  /** the indication unit ('kg' for the load-cell family). */
  unit: Unit
}

/** The declared reading uncertainty: ±½ graduation (rectangular) — a
 *  human interpolates between divisions to about half a division. */
export function readingUncertaintyKg(spec: DialSpec): number {
  return spec.graduationKg / 2
}

/** The pointer's rest position for a ground-truth load: quantized to
 *  the pointer's resolution (the pointer rests at the nearest
 *  graduation), clamped to the dial's range. By construction
 *  |pointer − truth| ≤ graduation/2 inside the range. */
export function pointerPositionKg(spec: DialSpec, truthKg: number): number {
  const quantized = Math.round(truthKg / spec.graduationKg) * spec.graduationKg
  return Math.min(spec.capacityKg, Math.max(0, quantized))
}
