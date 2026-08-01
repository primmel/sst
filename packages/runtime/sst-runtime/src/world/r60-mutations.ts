// r60-mutations.ts — the runtime's own declaration of the R 60 /world
// mutation surface (typed-driver arg shapes). The kind's compile-time
// mirror lives kind-side (sst-instruments/packages/kinds/sst-r60/
// world-kind.d.ts — kept in sync by the kind's tests); the typed
// driver's callers should not import across the repo boundary, so the
// runtime ships this twin of the type.

import type { WorldState } from './types.js'

/** The R 60 /world mutations — one method per entry in world-kind.yaml. */
export interface R60WorldMutations {
  placeLoad(args: { massKg: number }): Promise<WorldState>
  removeLoad(): Promise<WorldState>
  setFidelity(args: { servedOffsetKg?: number; servedLagS?: number }): Promise<WorldState>
  fidelityReset(): Promise<WorldState>
  setThermalHysteresis(args: { perDegC: number; tauS?: number }): Promise<WorldState>
}
