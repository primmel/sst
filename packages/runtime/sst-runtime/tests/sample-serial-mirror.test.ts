// tests/sample-serial-mirror.test.ts — the booted sample's serial
// number mirrors into the twin's identification block (the twin IS the
// sampled unit): the default sample (fresh) answers LC500-001, an
// explicit sample boot answers that sample's serial, and the REST
// projection (GET /twin/instrument) carries the same value.

import { describe, it, expect, afterEach } from 'vitest'
import { loadPackage } from '../src/package-loader.js'
import { runSession, type Session } from '../src/session.js'

import { instancePath } from './lib.js'
const ACME_LC500 = instancePath('acme-lc500')

let session: Session | undefined
afterEach(async () => {
  await session?.close()
  session = undefined
})

async function querySerial(url: string): Promise<unknown> {
  const res = await fetch(`${url}/twin`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: '{ instrument { identification { serial } } }' }),
  })
  const body = await res.json() as { data?: { instrument?: { identification?: { serial?: string } } }; errors?: unknown }
  expect(body.errors).toBeUndefined()
  return body.data?.instrument?.identification?.serial
}

describe('the sample serial mirrors into the twin identification', () => {
  it('the default boot (fresh sample) answers LC500-001', async () => {
    const pkg = await loadPackage(ACME_LC500)
    session = await runSession(pkg, { port: 0, seed: 42 })
    expect(await querySerial(session.url)).toBe('LC500-001')
  })

  it('an explicit sample boot answers that sample’s serial', async () => {
    const pkg = await loadPackage(ACME_LC500)
    session = await runSession(pkg, { port: 0, seed: 42, sample: 'aged-2024' })
    expect(await querySerial(session.url)).toBe('LC500-007')
  })

  it('the REST projection carries the same serial (no GraphQL/REST drift)', async () => {
    const pkg = await loadPackage(ACME_LC500)
    session = await runSession(pkg, { port: 0, seed: 42 })
    const res = await fetch(`${session.url}/twin/instrument`)
    const body = await res.json() as { identification?: { serial?: string } }
    expect(body.identification?.serial).toBe('LC500-001')
  })
})
