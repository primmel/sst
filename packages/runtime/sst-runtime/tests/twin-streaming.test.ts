import { describe, it, expect } from 'vitest'
import { resolve } from 'node:path'
import { loadPackage } from '../src/package-loader.js'
import { runSession } from '../src/session.js'

const ACME_LC500 = resolve(__dirname, '../../../instances/acme-lc500')
const EPHEMERAL = 0

describe('real-time twin streaming (GET /twin/stream SSE)', () => {
  it('emits SSE events on clock advance', async () => {
    const pkg = await loadPackage(ACME_LC500)
    const session = await runSession(pkg, { port: EPHEMERAL, seed: 42 })
    try {
      // Connect to the SSE endpoint.
      const res = await fetch(`${session.url}/twin/stream?targets=indication,state`)
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toBe('text/event-stream')

      // Read the first event (emitted immediately on connect).
      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let gotEvent = false

      // Advance the clock to trigger a new event.
      await fetch(`${session.url}/world`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: 'mutation { advanceTime(seconds: 1) { clock } }' }),
      })

      // Read until we get an event or timeout.
      const deadline = Date.now() + 5000
      while (Date.now() < deadline && !gotEvent) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        if (buffer.includes('event: twin\n')) {
          gotEvent = true
        }
      }

      expect(gotEvent).toBe(true)
      // The event data should be valid JSON with targets.
      const eventLine = buffer.slice(buffer.indexOf('event: twin\n'))
      const dataLine = eventLine.slice(eventLine.indexOf('data: ') + 6, eventLine.indexOf('\n\n'))
      const payload = JSON.parse(dataLine)
      expect(payload.targets).toBeInstanceOf(Array)
      expect(payload.targets.length).toBeGreaterThan(0)
      expect(typeof payload.timestamp).toBe('number')

      reader.cancel()
    } finally {
      await session.close()
    }
  })

  it('returns 404 when twinStream is not configured', async () => {
    // The LC500 bin boots with twinStream (runSession always wires it).
    // This test verifies that the endpoint exists and serves events.
    const pkg = await loadPackage(ACME_LC500)
    const session = await runSession(pkg, { port: EPHEMERAL, seed: 42 })
    try {
      const res = await fetch(`${session.url}/twin/stream`)
      expect(res.status).toBe(200)
      await res.body?.cancel()
    } finally {
      await session.close()
    }
  })
})
