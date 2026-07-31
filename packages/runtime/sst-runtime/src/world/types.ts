// world/types.ts — shared types between the server-side world schema
// generator and the client-side WorldDriver.

/** The world's verdict on a mutation — its current state plus ground truth. */
export interface WorldState {
  clock: number
  mode: string
  groundTruth: unknown
}

/** A scenario registry entry. */
export interface ScenarioInfo {
  name: string
  description: string
}

/** A profile registry entry (D 11 chamber programs). */
export interface ProfileInfo {
  id: string
  standard: string
}
