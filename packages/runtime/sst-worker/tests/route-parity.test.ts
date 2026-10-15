// tests/route-parity.test.ts — the route-surface parity pin: the same
// request → the same answer on the node server and the worker adapter.
//
//   LEG A — the synthetic session (no library needed): both transports
//   serve the SAME BundleSession; the parity isolates the transport.
//
//   LEG B — the real acme-lc500 (SST_LIBRARY_PATH-declared, honest
//   skip): the node FS boot (runSession) vs the worker's bundle boot —
//   the two boots must agree per route, including the signed-serve
//   posture's signature verifying over the wire.

import { describe, it, expect, afterAll } from 'vitest'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { bootBundleSession, type BundleSession } from '@primmel/sst-runtime/session/boot-bundle'
import { runSession } from '@primmel/sst-runtime/session'
import { loadPackage } from '@primmel/sst-runtime/package-loader'
import { importVerifyKey, verifyServeEnvelope } from '@primmel/sst-runtime/twin/serve-signing'
import {
  assembleLibraryBundle,
  libraryRoot,
  nodeServerFor,
  workerHandlerFor,
  nodeHttp,
  workerHttp,
  parityCases,
  expectParity,
  firstSseEvent,
  syntheticBundle,
} from './lib.js'

const STAGING_ORIGIN = 'https://staging-demo.oimlsmart.org'

const closers: Array<() => Promise<void>> = []
afterAll(async () => { for (const c of closers) await c() })

describe('LEG A — synthetic session: node transport ↔ worker transport', () => {
  it('answers every route identically', async () => {
    const session = await bootBundleSession(syntheticBundle())
    const node = await nodeServerFor(session, { corsOrigins: STAGING_ORIGIN })
    closers.push(node.close)
    const worker = workerHandlerFor(session, { corsOrigins: STAGING_ORIGIN })

    for (const c of parityCases(STAGING_ORIGIN)) {
      await expectParity(nodeHttp(node.url), workerHttp(worker), c)
    }
  })

  it('the SSE first event matches (id + targets payload)', async () => {
    const session = await bootBundleSession(syntheticBundle())
    const node = await nodeServerFor(session)
    closers.push(node.close)
    const worker = workerHandlerFor(session)

    // Advance both transports' clock deterministically first.
    await fetch(new URL('/world', node.url), {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: 'mutation { advanceTime(seconds: 10) { clock } }' }),
    })
    await worker(new Request('http://worker.local/world', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: 'mutation { advanceTime(seconds: 10) { clock } }' }),
    }))

    const nodeEvent = await firstSseEvent(await fetch(new URL('/twin/stream?targets=indication,state', node.url)))
    const workerEvent = await firstSseEvent(await worker(new Request('http://worker.local/twin/stream?targets=indication,state')))
    expect(workerEvent.id).toBe(nodeEvent.id)
    expect(JSON.parse(workerEvent.data)).toEqual(JSON.parse(nodeEvent.data))
  })

  it('CORS: the configured origin echoes; a foreign origin is refused', async () => {
    const session = await bootBundleSession(syntheticBundle())
    const node = await nodeServerFor(session, { corsOrigins: STAGING_ORIGIN })
    closers.push(node.close)
    const worker = workerHandlerFor(session, { corsOrigins: STAGING_ORIGIN })

    // Preflight, configured origin → 204 + the response headers.
    const nodePre = await fetch(new URL('/world', node.url), { method: 'OPTIONS', headers: { origin: STAGING_ORIGIN, 'access-control-request-method': 'POST' } })
    const workerPre = await worker(new Request('http://worker.local/world', { method: 'OPTIONS', headers: { origin: STAGING_ORIGIN, 'access-control-request-method': 'POST' } }))
    expect(workerPre.status).toBe(nodePre.status)
    expect(workerPre.status).toBe(204)
    expect(workerPre.headers.get('access-control-allow-origin')).toBe(nodePre.headers.get('access-control-allow-origin'))
    expect(workerPre.headers.get('access-control-allow-methods')).toBe(nodePre.headers.get('access-control-allow-methods'))
    expect(workerPre.headers.get('access-control-allow-headers')).toBe(nodePre.headers.get('access-control-allow-headers'))

    // Preflight, foreign origin → 403 on both.
    const foreign = 'https://evil.example'
    const nodePreForeign = await fetch(new URL('/world', node.url), { method: 'OPTIONS', headers: { origin: foreign, 'access-control-request-method': 'POST' } })
    const workerPreForeign = await worker(new Request('http://worker.local/world', { method: 'OPTIONS', headers: { origin: foreign, 'access-control-request-method': 'POST' } }))
    expect(workerPreForeign.status).toBe(nodePreForeign.status)
    expect(workerPreForeign.status).toBe(403)

    // A plain GET with the configured origin carries the allow header.
    const nodeGet = await fetch(new URL('/twin/instrument', node.url), { headers: { origin: STAGING_ORIGIN } })
    const workerGet = await worker(new Request('http://worker.local/twin/instrument', { headers: { origin: STAGING_ORIGIN } }))
    expect(workerGet.headers.get('access-control-allow-origin')).toBe(nodeGet.headers.get('access-control-allow-origin'))
    expect(workerGet.headers.get('access-control-allow-origin')).toBe(STAGING_ORIGIN)

    // A plain GET with a foreign origin carries NO allow header.
    const nodeGetForeign = await fetch(new URL('/twin/instrument', node.url), { headers: { origin: foreign } })
    const workerGetForeign = await worker(new Request('http://worker.local/twin/instrument', { headers: { origin: foreign } }))
    expect(workerGetForeign.headers.get('access-control-allow-origin')).toBeNull()
    expect(nodeGetForeign.headers.get('access-control-allow-origin')).toBeNull()
  })

  it('CORS unset → no allow headers at all (the honest closed posture)', async () => {
    const session = await bootBundleSession(syntheticBundle())
    const node = await nodeServerFor(session)
    closers.push(node.close)
    const worker = workerHandlerFor(session)
    const nodeGet = await fetch(new URL('/twin/instrument', node.url), { headers: { origin: STAGING_ORIGIN } })
    const workerGet = await worker(new Request('http://worker.local/twin/instrument', { headers: { origin: STAGING_ORIGIN } }))
    expect(nodeGet.headers.get('access-control-allow-origin')).toBeNull()
    expect(workerGet.headers.get('access-control-allow-origin')).toBeNull()
  })

  it('/world mutation guard: the same bearer posture on both transports', async () => {
    const session = await bootBundleSession(syntheticBundle())
    const token = 'test-token'
    const node = await nodeServerFor(session, { worldToken: token })
    closers.push(node.close)
    const worker = workerHandlerFor(session, { worldToken: token })
    const query = { query: 'mutation { placeLoad(massKg: 1) { groundTruth { appliedLoadKg } } }' }
    const post = (base: string | Request) =>
      base instanceof Request
        ? worker(new Request(new URL('/world', base.url), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(query) }))
        : fetch(new URL('/world', base), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(query) })

    // Without the bearer: 401-class rejection on both (the guard plugin
    // answers a GraphQL error payload with an http status extension).
    const nodeDenied = await post(node.url)
    const workerDenied = await post(new Request('http://worker.local/'))
    expect(workerDenied.status).toBe(nodeDenied.status)

    // With the bearer: the mutation runs on both.
    const withBearer = (base: string | Request) =>
      base instanceof Request
        ? worker(new Request(new URL('/world', base.url), { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify(query) }))
        : fetch(new URL('/world', base), { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify(query) })
    const nodeOk = await withBearer(node.url)
    const workerOk = await withBearer(new Request('http://worker.local/'))
    expect(await workerOk.json()).toEqual(await nodeOk.json())
  })
})

describe('LEG B — acme-lc500: node FS boot (runSession) ↔ worker bundle boot', { skip: libraryRoot() === null }, () => {
  const lib = libraryRoot()!

  it('boots both ways and answers the parity script identically', async () => {
    // The worker side: bundle boot from the SAME library checkout.
    const bundle = await assembleLibraryBundle(lib)
    const bundleSession = await bootBundleSession(bundle, {})
    const worker = workerHandlerFor(bundleSession, { corsOrigins: STAGING_ORIGIN })

    // The node side: the FS boot (the bins' path).
    const pkg = await loadPackage(join(lib, 'packages', 'instances', 'acme-lc500'))
    const session = await runSession(pkg, { port: 0, corsOrigins: STAGING_ORIGIN })
    closers.push(session.close)

    for (const c of parityCases(STAGING_ORIGIN)) {
      await expectParity(nodeHttp(session.url), workerHttp(worker), c)
    }
  })

  it('the /twin identity serves the demo serial LC500-001 on both boots', async () => {
    const bundle = await assembleLibraryBundle(lib)
    const worker = workerHandlerFor(await bootBundleSession(bundle, {}))
    const pkg = await loadPackage(join(lib, 'packages', 'instances', 'acme-lc500'))
    const session = await runSession(pkg, { port: 0 })
    closers.push(session.close)

    const nodeIdentity = (await (await fetch(new URL('/twin/instrument', session.url))).json()) as { identification: { serial?: string; instrumentId: string } }
    const workerIdentity = (await (await worker(new Request('http://worker.local/twin/instrument'))).json()) as typeof nodeIdentity
    expect(nodeIdentity.identification.serial).toBe('LC500-001')
    expect(workerIdentity.identification.serial).toBe('LC500-001')
    expect(workerIdentity.identification.instrumentId).toBe('acme-lc500')
  })

  it('the signed-serve posture: the worker signs, and the signature verifies', async () => {
    const bundle = await assembleLibraryBundle(lib)
    const signed = await bootBundleSession(bundle, { signedServe: true })
    expect(signed.signing).toBeDefined()
    const worker = workerHandlerFor(signed, { corsOrigins: STAGING_ORIGIN })

    const res = await worker(new Request('http://worker.local/twin/registers/indication', { headers: { origin: STAGING_ORIGIN } }))
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      value: number; unit: string; kind: string; servedAt: string
      signature: { algorithm: string; key_id: string; endpoint: string; register: string; public_key_spki?: string; signature: string }
    }
    // The signed wire: ISO servedAt + the signature member.
    expect(new Date(body.servedAt).toISOString()).toBe(body.servedAt)
    expect(body.signature.algorithm).toBe('ECDSA-P256-SHA256')
    expect(body.signature.endpoint).toBe('loadcell_api')

    // The envelope verifies against the declared public key (the
    // canonical bytes the smart platform's verifier checks).
    const publicKey = await importVerifyKey(body.signature.public_key_spki!)
    const verdict = await verifyServeEnvelope(
      { endpoint: body.signature.endpoint, register: body.signature.register, value: body.value, unit: body.unit, servedAt: body.servedAt },
      { ...body.signature, algorithm: 'ECDSA-P256-SHA256' as const },
      publicKey,
    )
    expect(verdict).toEqual({ ok: true })
    // The declared freshness window rides the header (the contract's
    // freshWithinS for indication).
    expect(res.headers.get('fresh-within-s')).toBe('5')
  })

  it('the unsigned default stays unsigned (the manifest block is inert)', async () => {
    const bundle = await assembleLibraryBundle(lib)
    const unsigned = await bootBundleSession(bundle, {})
    expect(unsigned.signing).toBeUndefined()
    const worker = workerHandlerFor(unsigned)
    const body = (await (await worker(new Request('http://worker.local/twin/registers/indication'))).json()) as { servedAt: number | string; signature?: unknown }
    expect(body.signature).toBeUndefined()
    expect(typeof body.servedAt).toBe('number')
  })
})

// The library-declared guard: the path must exist for LEG B to run.
describe('LEG B declarations', () => {
  it('SST_LIBRARY_PATH (when set) declares a real library tree', () => {
    const lib = libraryRoot()
    if (lib === null) return
    expect(existsSync(join(lib, 'packages', 'instances', 'acme-lc500'))).toBe(true)
  })
})
