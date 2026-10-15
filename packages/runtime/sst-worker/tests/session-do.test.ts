// tests/session-do.test.ts — the Durable Object's honest lifecycle:
// lazy boot on first request, the idle alarm re-armed per request, the
// alarm dropping the in-memory session, and a fresh boot re-established
// on the next request (the platform's Connect stage re-establishes; the
// physics is seeded and deterministic).

import { describe, it, expect } from 'vitest'
import { bootBundleSession, type SessionBundle } from '@primmel/sst-runtime/session/boot-bundle'
import { SimSession } from '../src/session-do.js'
import { syntheticBundle } from './lib.js'

function fakeState(): { state: DurableObjectState; alarms: number[] } {
  const alarms: number[] = []
  const state = {
    storage: {
      async setAlarm(t: number): Promise<void> { alarms.push(t) },
      async getAlarm(): Promise<number | null> { return alarms.at(-1) ?? null },
      async deleteAlarm(): Promise<void> { alarms.length = 0 },
    },
  } as unknown as DurableObjectState
  return { state, alarms }
}

/** A SimSession over the synthetic bundle, counting boots. */
function bootedSession(bundle: SessionBundle, env: Record<string, string>): { session: SimSession; boots: () => number } {
  let count = 0
  const { state } = fakeState()
  const session = new SimSession(state, env, () => { count++; return bundle })
  return { session, boots: () => count }
}

describe('SimSession (the DO lifecycle)', () => {
  it('boots lazily on the first request and re-arms the idle alarm', async () => {
    const bundle = syntheticBundle()
    const { session, boots } = bootedSession(bundle, { corsOrigins: 'https://demo.example' })
    expect(boots()).toBe(0)
    const res = await session.fetch(new Request('http://do.local/twin/instrument'))
    expect(res.status).toBe(200)
    expect(boots()).toBe(1)
    const res2 = await session.fetch(new Request('http://do.local/twin/instrument'))
    expect(res2.status).toBe(200)
    expect(boots()).toBe(1) // no re-boot on a warm session
  })

  it('the alarm drops the session; the next request boots a fresh one', async () => {
    const bundle = syntheticBundle()
    const { session, boots } = bootedSession(bundle, {})
    await session.fetch(new Request('http://do.local/world', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: 'mutation { placeLoad(massKg: 40) { groundTruth { appliedLoadKg } } }' }),
    }))
    await session.alarm() // the idle expiry
    expect(boots()).toBe(1)

    // The fresh boot: the same seed → the same instrument (load gone).
    const res = await session.fetch(new Request('http://do.local/world', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: '{ groundTruth { appliedLoadKg } }' }),
    }))
    expect(boots()).toBe(2)
    expect(((await res.json()) as { data: { groundTruth: { appliedLoadKg: number } } }).data.groundTruth.appliedLoadKg).toBe(0)
  })

  it('SST_SIGNED_SERVE=1 activates the manifest signing block', async () => {
    // The synthetic bundle declares no signing block — the knob must be
    // inert without one (the lc500 signed posture has its own leg in
    // route-parity.test.ts).
    const bundle = syntheticBundle()
    const { session } = bootedSession(bundle, { SST_SIGNED_SERVE: '1' })
    const res = await session.fetch(new Request('http://do.local/twin/registers/indication'))
    const body = (await res.json()) as { signature?: unknown }
    expect(body.signature).toBeUndefined() // no signing block declared → inert
  })
})
