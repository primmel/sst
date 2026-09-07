// tests/signed-serve-boot.test.ts — the signed-serve posture on a REAL
// boot (spec §12): the ACME CGM-200 serving signed envelopes over HTTP,
// and the activation discipline (the declaration governs):
//
//   SessionOptions.signing activates directly (the programmatic
//   deployment act) — the served indication_co carries the verifiable
//   envelope + canonical-ISO servedAt;
//   the manifest's signing: block alone is INERT — only the
//   SST_SIGNED_SERVE env activates it (a committed block never changes
//   the default boot's bytes).

import { describe, it, expect, afterEach } from 'vitest'
import { loadPackage } from '../src/package-loader.js'
import { runSession, type Session } from '../src/session.js'
import { resolveBootSigning } from '../src/session/boot.js'
import {
  generateSigningKey,
  importVerifyKey,
  verifyServeEnvelope,
  SIGNED_SERVE_ENV,
  type ServeEnvelopeSignatureWire,
  type ServeSigningDecl,
} from '../src/twin/serve-signing.js'

import { instancePath } from './lib.js'
const ACME_CGM200 = instancePath('acme-cgm-200')

let session: Session | undefined
afterEach(async () => {
  await session?.close()
  session = undefined
})

const DECL = (gen: Awaited<ReturnType<typeof generateSigningKey>>): ServeSigningDecl => ({
  endpoint: 'cgm_api',
  key_id: gen.keyId,
  public_key_spki: gen.publicKeySpki,
  private_key_pkcs8: gen.privateKeyPkcs8,
})

describe('a real signed boot (the ACME CGM-200 serving envelopes over HTTP)', () => {
  it('the served indication_co verifies byte-exact; a tampered value verifies FALSE', async () => {
    const gen = await generateSigningKey('cgm200-unit-42-key-1')
    const pkg = await loadPackage(ACME_CGM200)
    session = await runSession(pkg, { port: 0, seed: 42, signing: DECL(gen) })
    const res = await fetch(`${session.url}/twin`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: '{ indicationCo { value unit kind servedAt signature } }' }),
    })
    const body = await res.json() as { data?: { indicationCo?: { value: number; unit: string; kind: string; servedAt: string; signature: ServeEnvelopeSignatureWire } }; errors?: unknown }
    expect(body.errors).toBeUndefined()
    const q = body.data!.indicationCo!
    expect(q.servedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
    expect(new Date(Date.parse(q.servedAt)).toISOString()).toBe(q.servedAt)
    expect(q.signature.endpoint).toBe('cgm_api')
    expect(q.signature.register).toBe('indication_co')
    const v = await verifyServeEnvelope(
      { endpoint: 'cgm_api', register: 'indication_co', value: q.value, unit: q.unit, servedAt: q.servedAt },
      q.signature,
      await importVerifyKey(gen.publicKeySpki),
    )
    expect(v).toEqual({ ok: true })
    const tampered = await verifyServeEnvelope(
      { endpoint: 'cgm_api', register: 'indication_co', value: q.value + 5, unit: q.unit, servedAt: q.servedAt },
      q.signature,
      await importVerifyKey(gen.publicKeySpki),
    )
    expect(tampered.ok).toBe(false)
  }, 30_000)
})

describe('the activation discipline (the declaration governs)', () => {
  afterEach(() => {
    delete process.env[SIGNED_SERVE_ENV]
  })

  it('the manifest block alone is inert; the env activates it; the programmatic declaration needs no env', async () => {
    const gen = await generateSigningKey('key-1')
    const decl = DECL(gen)

    // Manifest block, no env ⇒ unsigned (the default face).
    delete process.env[SIGNED_SERVE_ENV]
    expect(await resolveBootSigning(decl, undefined)).toBeUndefined()

    // Manifest block + env ⇒ active.
    process.env[SIGNED_SERVE_ENV] = '1'
    const viaEnv = await resolveBootSigning(decl, undefined)
    expect(viaEnv?.endpoint).toBe('cgm_api')
    expect(viaEnv?.key.keyId).toBe('key-1')

    // The programmatic declaration activates without the env.
    delete process.env[SIGNED_SERVE_ENV]
    const viaOpts = await resolveBootSigning(undefined, decl)
    expect(viaOpts?.endpoint).toBe('cgm_api')

    // The programmatic declaration wins over the manifest's.
    const gen2 = await generateSigningKey('key-2')
    process.env[SIGNED_SERVE_ENV] = 'true'
    const both = await resolveBootSigning(decl, DECL(gen2))
    expect(both?.key.keyId).toBe('key-2')
  })
})
