// twin/types.ts — shared types between the server-side twin schema
// generator and the client-side TwinDriver.

/** A served quantity — the canonical twin response shape for an
 *  indication register. Mirrors the server's ServedQuantity GraphQL type. */
export interface ServedQuantity {
  value: number
  unit: string
  kind: string
  servedAt: number          // epoch seconds
}

/** The instrument's environmental context. Mirrors the Environment type. */
export interface Environment {
  temperatureDegC: number
  humidityPercentRh: number
  pressureKPa: number
}

/** The result of an instrument-legal command operation (zero-setting,
 *  self-test, calibration). Mirrors the server's OpResult type. */
export interface OpResult {
  state: string
}

/** Maps a serve target id to its driver return type. Core targets have
 *  well-known shapes; everything else falls back to ServedQuantity. */
export type ServeTargetReturn<Target extends string> =
  Target extends 'indication' ? ServedQuantity :
  Target extends 'state' ? string :
  Target extends 'environmental_context' ? Environment :
  ServedQuantity

/** Options for createTwinDriver. */
export interface DriverOpts {
  /** What to do when a read returns servedAt older than freshWithinS.
   *  - 'ignore' (default): silent
   *  - 'warn': console.warn
   *  - 'throw': reject the promise
   */
  onStale?: 'ignore' | 'warn' | 'throw' | undefined

  /** Optional fetch override (for tests, proxies, etc.). */
  fetch?: typeof fetch | undefined
}
