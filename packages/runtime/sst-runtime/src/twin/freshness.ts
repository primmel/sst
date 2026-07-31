// twin/freshness.ts — the freshness-check helper. Each serve carries
// freshWithinS in the contract; the TwinDriver surfaces this and
// optionally warns or throws when servedAt is stale.

import type { DriverOpts } from './types.js'

/** The staleness check shared by every read method. */
export function checkFreshness(
  target: string,
  servedAt: number,
  freshWithinS: number | undefined,
  opts: DriverOpts | undefined,
  now: () => number = Date.now.bind(Date),
): void {
  if (freshWithinS == null) return
  const ageS = now() / 1000 - servedAt
  if (ageS <= freshWithinS) return
  const msg = `twin register '${target}' is stale: age ${ageS.toFixed(1)}s exceeds freshWithinS ${freshWithinS}s`
  const behavior = opts?.onStale ?? 'ignore'
  if (behavior === 'warn') console.warn(msg)
  if (behavior === 'throw') throw new Error(msg)
}
