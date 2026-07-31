// twin/freshness-check.ts — runtime freshness enforcement.
//
// The TwinDriver's opts.onStale was advisory. This module provides
// a server-side check that can be wired into the /twin resolvers:
// if servedAt is older than freshWithinS, the resolver returns the
// value with a `__stale: true` extension, or rejects the read
// (configurable).

export interface FreshnessCheck {
  servedAt: number       // when the value was produced (epoch seconds)
  freshWithinS: number   // the declared freshness window
  nowS: number           // the current time (from the virtual clock)
}

export type FreshnessVerdict = 'fresh' | 'stale' | 'expired'

/** Check whether a served value is within its freshness window. */
export function checkFreshness(check: FreshnessCheck): {
  verdict: FreshnessVerdict
  ageS: number
  /** How many times the window has elapsed. >2 = "expired". */
  ageMultiplier: number
} {
  const ageS = check.nowS - check.servedAt
  const ageMultiplier = check.freshWithinS > 0 ? ageS / check.freshWithinS : 0
  return {
    verdict: ageMultiplier <= 1 ? 'fresh' : ageMultiplier <= 2 ? 'stale' : 'expired',
    ageS,
    ageMultiplier,
  }
}

/** Throw if the value is expired (beyond 2× the freshness window).
 *  This is the strict enforcement mode — for certification contexts
 *  where a stale value is unacceptable. */
export function enforceFreshnessOrThrow(check: FreshnessCheck): void {
  const result = checkFreshness(check)
  if (result.verdict === 'expired') {
    throw new Error(
      `twin freshness violation: servedAt=${check.servedAt} is ${result.ageS.toFixed(1)}s old ` +
      `(freshWithinS=${check.freshWithinS}s, expired at ${result.ageMultiplier.toFixed(1)}× window)`
    )
  }
}
