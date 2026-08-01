// tests/sampling-line.test.ts — the sst-sampling-line kind's unit tests.
//
// Boots the ACME CGM-200 sampling-line instance standalone via runSession
// and verifies:
//   - the /twin serves the declared registers
//   - the /world mutations move the physics
//   - the transport delay carries inlet to outlet
//   - the flow interlock faults the line and decays outlet to ambient
//   - recovery restores the line to ok state

import { describe, it, expect } from 'vitest'
import { resolve } from 'node:path'
import { loadPackage } from '../src/package-loader.js'
import { runSession } from '../src/session.js'

const SAMPLING_LINE = resolve(__dirname, '../../../instances/acme-cgm-sampling-line')
const EPHEMERAL = 0

async function gql(url: string, channel: '/twin' | '/world', query: string): Promise<any> {
  const res = await fetch(`${url}${channel}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query }),
  })
  const body = (await res.json()) as { data?: any; errors?: Array<{ message: string }> }
  if (body.errors?.length) throw new Error(body.errors.map(e => e.message).join('; '))
  return body.data
}

describe('the sampling-line kind (sst-sampling-line)', () => {
  it('boots standalone and serves the declared registers on /twin', async () => {
    const pkg = await loadPackage(SAMPLING_LINE)
    const session = await runSession(pkg, { port: EPHEMERAL, seed: 42 })
    try {
      const d = await gql(session.url, '/twin', `{
        sampleFlow { value unit }
        gasTemperature { value unit }
        transportDelay { value unit }
        linePressure { value unit }
        state
      }`)
      expect(d.sampleFlow.unit).toBe('L/min')
      expect(d.sampleFlow.value).toBeCloseTo(1.5, 1)
      expect(d.gasTemperature.unit).toBe('°C')
      expect(d.transportDelay.unit).toBe('s')
      expect(d.linePressure.unit).toBe('kPa')
      expect(d.state).toBe('ok')
    } finally {
      await session.close()
    }
  })

  it('the transport delay carries the inlet to the outlet', async () => {
    const pkg = await loadPackage(SAMPLING_LINE)
    const session = await runSession(pkg, { port: EPHEMERAL, seed: 42 })
    try {
      // Inject a known CO concentration at the inlet; wait for the
      // transport delay; verify the outlet picks it up.
      await gql(session.url, '/world', `mutation { setInletComposition(coPpm: 25) { clock } }`)
      await gql(session.url, '/world', `mutation { advanceTime(seconds: 15) { clock } }`)
      const d = await gql(session.url, '/world', `{ groundTruth { outletComposition { coPpm } line { faulted } } }`)
      expect(d.groundTruth.outletComposition.coPpm).toBeGreaterThan(20)
      expect(d.groundTruth.outletComposition.coPpm).toBeLessThan(25.1)
      expect(d.groundTruth.line.faulted).toBe(false)
    } finally {
      await session.close()
    }
  })

  it('the flow interlock faults the line when flow drops below the minimum', async () => {
    const pkg = await loadPackage(SAMPLING_LINE)
    const session = await runSession(pkg, { port: EPHEMERAL, seed: 42 })
    try {
      // Prime the line with a known CO inlet.
      await gql(session.url, '/world', `mutation { setInletComposition(coPpm: 25) { clock } }`)
      await gql(session.url, '/world', `mutation { advanceTime(seconds: 15) { clock } }`)
      // Starve the line.
      await gql(session.url, '/world', `mutation { setFlowRate(lPerMin: 0) { clock } }`)
      await gql(session.url, '/world', `mutation { advanceTime(seconds: 30) { clock } }`)

      const d = await gql(session.url, '/world', `{ groundTruth { line { faulted } outletComposition { coPpm } } }`)
      expect(d.groundTruth.line.faulted).toBe(true)

      // The /twin state field reflects the fault.
      const t = await gql(session.url, '/twin', `{ state }`)
      expect(t.state).toBe('fault')

      // The outlet decayed toward ambient (0.4 ppm); certainly below
      // half the primed value.
      expect(d.groundTruth.outletComposition.coPpm).toBeLessThan(12.5)
    } finally {
      await session.close()
    }
  })

  it('the leak dilution blends the outlet toward ambient', async () => {
    const pkg = await loadPackage(SAMPLING_LINE)
    const session = await runSession(pkg, { port: EPHEMERAL, seed: 42 })
    try {
      await gql(session.url, '/world', `mutation { setInletComposition(coPpm: 25) { clock } }`)
      await gql(session.url, '/world', `mutation { introduceLeak(fraction: 0.5) { clock } }`)
      await gql(session.url, '/world', `mutation { advanceTime(seconds: 15) { clock } }`)
      const d = await gql(session.url, '/world', `{ groundTruth { outletComposition { coPpm } line { leakFraction } } }`)
      // 50% leak: outlet ≈ 25 × 0.5 + 0.4 × 0.5 ≈ 12.7 ppm
      expect(d.groundTruth.outletComposition.coPpm).toBeGreaterThan(10)
      expect(d.groundTruth.outletComposition.coPpm).toBeLessThan(15)
      expect(d.groundTruth.line.leakFraction).toBeCloseTo(0.5, 1)
    } finally {
      await session.close()
    }
  })

  it('recovery restores the line to ok state and re-delivers sample', async () => {
    const pkg = await loadPackage(SAMPLING_LINE)
    const session = await runSession(pkg, { port: EPHEMERAL, seed: 42 })
    try {
      // Prime, starve (fault), then restore flow.
      await gql(session.url, '/world', `mutation { setInletComposition(coPpm: 25) { clock } }`)
      await gql(session.url, '/world', `mutation { advanceTime(seconds: 15) { clock } }`)
      await gql(session.url, '/world', `mutation { setFlowRate(lPerMin: 0) { clock } }`)
      await gql(session.url, '/world', `mutation { advanceTime(seconds: 30) { clock } }`)

      // Restore flow above the minimum and clear the fault.
      await gql(session.url, '/world', `mutation { setFlowRate(lPerMin: 1.5) { clock } }`)
      await gql(session.url, '/world', `mutation { advanceTime(seconds: 1) { clock } }`)

      // The fault latch requires explicit clearFault() OR reset().
      // The runtime exposes reset on /world.
      await gql(session.url, '/world', `mutation { reset { clock } }`)

      // Re-prime and verify outlet recovers.
      await gql(session.url, '/world', `mutation { setInletComposition(coPpm: 25) { clock } }`)
      await gql(session.url, '/world', `mutation { advanceTime(seconds: 15) { clock } }`)
      const d = await gql(session.url, '/twin', `{ state sampleFlow { value } }`)
      expect(d.state).toBe('ok')
      expect(d.sampleFlow.value).toBeCloseTo(1.5, 1)
    } finally {
      await session.close()
    }
  })
})
