// tests/serve-signing.test.ts — the signed-serve envelope producer
// (spec §12's signed-serve posture): the canonicalization pinned
// BYTE-COMPATIBLE with the smart platform's canonicalJson +
// serve-envelope discipline (the consumer owns the wire contract —
// a drift on either side fails these vectors loudly), the ES256
// round trip, and the tamper legs (a served value that is not what
// the twin signed VERIFIES FALSE — the composite's cryptographic
// floor).

import { describe, it, expect } from 'vitest'
import {
  b64url,
  canonicalJson,
  canonicalServeEnvelope,
  generateSigningKey,
  importSigningKey,
  importVerifyKey,
  resolveServeSigning,
  signServeEnvelope,
  signedQuantityReader,
  unb64url,
  verifyServeEnvelope,
} from '../src/twin/serve-signing.js'

describe('canonicalJson (the smart-platform byte contract)', () => {
  it('sorts keys deep, no whitespace — the pinned vectors', () => {
    expect(canonicalJson({ b: 1, a: { d: [2, { c: true }], b: null } })).toBe(
      '{"a":{"b":null,"d":[2,{"c":true}]},"b":1}',
    )
    expect(canonicalJson({ value: 40.05, unit: 'kg' })).toBe('{"unit":"kg","value":40.05}')
    expect(canonicalJson('x')).toBe('"x"')
    expect(canonicalJson([3, 1])).toBe('[3,1]')
  })

  it('the envelope vector: {endpoint, register, servedAt, value, unit?} deep-sorted', () => {
    // THE cross-repo pin: smart's canonicalServeEnvelope over the same
    // payload must produce these exact bytes.
    expect(canonicalServeEnvelope({
      endpoint: 'cgm_api',
      register: 'indication_co',
      servedAt: '2026-09-07T10:00:00.000Z',
      value: 101.4,
      unit: 'ppm',
    })).toBe(
      '{"endpoint":"cgm_api","register":"indication_co","servedAt":"2026-09-07T10:00:00.000Z","unit":"ppm","value":101.4}',
    )
    // unit absent ⇒ the member drops (never null-valued).
    expect(canonicalServeEnvelope({
      endpoint: 'lc500_api',
      register: 'indication',
      servedAt: '2026-09-07T10:00:00.000Z',
      value: 40,
    })).toBe(
      '{"endpoint":"lc500_api","register":"indication","servedAt":"2026-09-07T10:00:00.000Z","value":40}',
    )
  })
})

describe('the base64url pair', () => {
  it('round-trips and is url-safe', () => {
    const bytes = new Uint8Array([0, 1, 250, 251, 255, 62, 63]).buffer
    const s = b64url(bytes)
    expect(s).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(new Uint8Array(unb64url(s))).toEqual(new Uint8Array(bytes))
  })
})

describe('the ES256 envelope (the device-side act + the consumer verify)', () => {
  it('sign → verify round trip; the wire block is the snake_case self-describing member', async () => {
    const key = await generateSigningKey('cgm200-unit-42-key-1')
    const payload = {
      endpoint: 'cgm_api',
      register: 'indication_co',
      value: 101.4,
      unit: 'ppm',
      servedAt: '2026-09-07T10:00:00.000Z',
    }
    const sig = await signServeEnvelope(payload, key)
    expect(sig.algorithm).toBe('ECDSA-P256-SHA256')
    expect(sig.key_id).toBe('cgm200-unit-42-key-1')
    expect(sig.endpoint).toBe('cgm_api')
    expect(sig.register).toBe('indication_co')
    expect(sig.public_key_spki).toBe(key.publicKeySpki)
    expect(sig.signature).toMatch(/^[A-Za-z0-9_-]+$/)

    const verifyKey = await importVerifyKey(key.publicKeySpki)
    const v = await verifyServeEnvelope(payload, sig, verifyKey)
    expect(v).toEqual({ ok: true })
  })

  it('the provisioned pair (pkcs8/spki base64url) imports and signs verifiably', async () => {
    const gen = await generateSigningKey('sample-line-7-key-1')
    const key = await importSigningKey({
      key_id: gen.keyId,
      public_key_spki: gen.publicKeySpki,
      private_key_pkcs8: gen.privateKeyPkcs8,
    })
    const payload = {
      endpoint: 'sample_line_api',
      register: 'sample.test_context.flow',
      value: 2.5,
      unit: 'l/min',
      servedAt: '2026-09-07T10:00:01.000Z',
    }
    const sig = await signServeEnvelope(payload, key)
    const v = await verifyServeEnvelope(payload, sig, await importVerifyKey(gen.publicKeySpki))
    expect(v).toEqual({ ok: true })
  })

  it('TAMPER: a served value that is not what was signed verifies FALSE, named', async () => {
    const key = await generateSigningKey('cgm200-unit-42-key-1')
    const payload = {
      endpoint: 'cgm_api',
      register: 'indication_co',
      value: 101.4,
      unit: 'ppm',
      servedAt: '2026-09-07T10:00:00.000Z',
    }
    const sig = await signServeEnvelope(payload, key)
    const verifyKey = await importVerifyKey(key.publicKeySpki)
    const tampered = await verifyServeEnvelope({ ...payload, value: 999.9 }, sig, verifyKey)
    expect(tampered.ok).toBe(false)
    if (!tampered.ok) expect(tampered.reason).toContain('signature mismatch')
  })

  it('TAMPER: a different channel (endpoint / register) or a different key verifies FALSE', async () => {
    const key = await generateSigningKey('key-1')
    const other = await generateSigningKey('key-2')
    const payload = {
      endpoint: 'cgm_api',
      register: 'indication_co',
      value: 101.4,
      unit: 'ppm',
      servedAt: '2026-09-07T10:00:00.000Z',
    }
    const sig = await signServeEnvelope(payload, key)
    const verifyKey = await importVerifyKey(key.publicKeySpki)
    expect((await verifyServeEnvelope({ ...payload, endpoint: 'other_api' }, sig, verifyKey)).ok).toBe(false)
    expect((await verifyServeEnvelope({ ...payload, register: 'indication_nox' }, sig, verifyKey)).ok).toBe(false)
    expect((await verifyServeEnvelope({ ...payload, servedAt: '2026-09-07T10:00:01.000Z' }, sig, verifyKey)).ok).toBe(false)
    expect((await verifyServeEnvelope(payload, sig, await importVerifyKey(other.publicKeySpki))).ok).toBe(false)
  })
})

describe('the serve-time wrapper (signedQuantityReader)', () => {
  it('wraps a raw reader: servedAt becomes canonical ISO and the envelope verifies byte-exact', async () => {
    const gen = await generateSigningKey('cgm200-unit-42-key-1')
    const signing = await resolveServeSigning({
      endpoint: 'cgm_api',
      key_id: gen.keyId,
      public_key_spki: gen.publicKeySpki,
      private_key_pkcs8: gen.privateKeyPkcs8,
    })
    const epoch = new Date('2026-09-07T10:00:00.000Z').getTime() / 1000
    const read = signedQuantityReader('indication_co', () => ({
      value: 101.4, unit: 'ppm', kind: 'quantity', servedAt: epoch,
    }), signing)
    const served = await read()
    expect(served.servedAt).toBe('2026-09-07T10:00:00.000Z')
    expect(served.kind).toBe('quantity')
    const v = await verifyServeEnvelope(
      { endpoint: 'cgm_api', register: 'indication_co', value: 101.4, unit: 'ppm', servedAt: served.servedAt },
      served.signature,
      await importVerifyKey(gen.publicKeySpki),
    )
    expect(v).toEqual({ ok: true })
  })

  it('the register override attests the DECLARED aspect spelling (the sampling line)', async () => {
    const gen = await generateSigningKey('sample-line-7-key-1')
    const signing = await resolveServeSigning({
      endpoint: 'sample_line_api',
      key_id: gen.keyId,
      public_key_spki: gen.publicKeySpki,
      private_key_pkcs8: gen.privateKeyPkcs8,
      registers: { sample_flow: 'sample.test_context.flow' },
    })
    const read = signedQuantityReader('sample_flow', () => ({
      value: 1.5, unit: 'l/min', kind: 'quantity', servedAt: 1788784800,
    }), signing)
    const served = await read()
    expect(served.signature.register).toBe('sample.test_context.flow')
    expect(served.signature.endpoint).toBe('sample_line_api')
  })

  it('a reader that answers no served quantity fails loudly (never an implicit shape)', async () => {
    const gen = await generateSigningKey('key-1')
    const signing = await resolveServeSigning({
      endpoint: 'e', key_id: gen.keyId,
      public_key_spki: gen.publicKeySpki, private_key_pkcs8: gen.privateKeyPkcs8,
    })
    const read = signedQuantityReader('indication', () => 'ready' as never, signing)
    await expect(read()).rejects.toThrow("signed serve 'indication'")
  })
})
