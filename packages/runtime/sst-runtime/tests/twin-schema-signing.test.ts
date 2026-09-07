// tests/twin-schema-signing.test.ts — the generated /twin under the
// signed-serve posture (spec §12, opt-in): the LC-500 contract on a
// real SimulatedInstrument, signed at serve time.
//
//   the signed serve — value/unit/kind + servedAt as CANONICAL ISO +
//              the signature member; the envelope verifies byte-exact
//              against the device public key over the deep-sorted
//              canonical payload (the smart platform's contract);
//   the tamper leg — a value the twin did not sign verifies FALSE;
//   the named limit — the state serve stays a bare scalar (no
//              envelope);
//   the conformance leg — the startup no-drift gate stays green over
//              the signed schema;
//   the default — undeclared signing is the legacy face, byte-
//              unchanged (epoch servedAt, no signature member).

import { describe, it, expect } from 'vitest'
import { createYoga } from 'graphql-yoga'
import { generateTwinSchema, type TwinIo } from '../src/twin-schema.js'
import { checkTwinConformance } from '../src/conformance.js'
import { LC500_CONTRACT } from '../src/twin-contract.js'
import { VirtualClock } from '../src/time.js'
import { SimulatedInstrument } from '../src/instrument.js'
import { getScenario } from '../src/scenario.js'
import {
  generateSigningKey,
  importVerifyKey,
  verifyServeEnvelope,
  type ServeEnvelopeSignatureWire,
  type ServeSigning,
} from '../src/twin/serve-signing.js'

const ENDPOINT = 'lc500_api'

async function bootSigned() {
  const clock = new VirtualClock()
  const instrument = new SimulatedInstrument(getScenario('good-cell'), clock, 1)
  const gen = await generateSigningKey('lc500-unit-1-key-1')
  const signing: ServeSigning = {
    endpoint: ENDPOINT,
    key: { keyId: gen.keyId, privateKey: gen.privateKey, publicKeySpki: gen.publicKeySpki },
    registers: {},
  }
  const io: TwinIo = { instrument, clock, signing }
  const schema = generateTwinSchema(LC500_CONTRACT, io)
  const yoga = createYoga({ schema, graphqlEndpoint: '/twin' })
  return { clock, instrument, yoga, schema, gen }
}

async function gql(yoga: ReturnType<typeof createYoga>, query: string): Promise<unknown> {
  const res = await yoga.fetch('http://localhost/twin', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query }),
  })
  return (await res.json() as { data?: unknown; errors?: unknown }).data
}

async function gqlFull(yoga: ReturnType<typeof createYoga>, query: string): Promise<{ data?: unknown; errors?: unknown }> {
  const res = await yoga.fetch('http://localhost/twin', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query }),
  })
  return (await res.json()) as { data?: unknown; errors?: unknown }
}

describe('the signed-serve posture (spec §12, opt-in)', () => {
  it('the signed serve: canonical-ISO servedAt + the verifying envelope', async () => {
    const { yoga, instrument, clock, gen } = await bootSigned()
    clock.advance(400) // past warm-up (5× tau + margin)
    instrument.setLoad(500)
    clock.advance(5)
    const d = await gql(yoga, `query { indication { value unit kind servedAt signature } }`) as {
      indication: { value: number; unit: string; kind: string; servedAt: string; signature: ServeEnvelopeSignatureWire }
    }
    const q = d.indication
    expect(q.value).toBeCloseTo(500, 1)
    expect(q.unit).toBe('kg')
    expect(q.kind).toBe('mass')
    // Canonical ISO (toISOString form) — and it round-trips byte-exact
    // (the consumer reconstructs the coverage from the landed string).
    expect(q.servedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
    expect(new Date(Date.parse(q.servedAt)).toISOString()).toBe(q.servedAt)
    expect(Date.parse(q.servedAt)).toBe(Math.round(clock.now() * 1000))

    // The envelope is self-describing and verifies byte-exact.
    expect(q.signature.algorithm).toBe('ECDSA-P256-SHA256')
    expect(q.signature.key_id).toBe('lc500-unit-1-key-1')
    expect(q.signature.endpoint).toBe(ENDPOINT)
    expect(q.signature.register).toBe('indication')
    expect(q.signature.public_key_spki).toBe(gen.publicKeySpki)
    const v = await verifyServeEnvelope(
      { endpoint: ENDPOINT, register: 'indication', value: q.value, unit: q.unit, servedAt: q.servedAt },
      q.signature,
      await importVerifyKey(gen.publicKeySpki),
    )
    expect(v).toEqual({ ok: true })
  })

  it('TAMPER: the same envelope over a modified value verifies FALSE', async () => {
    const { yoga, instrument, clock, gen } = await bootSigned()
    clock.advance(400)
    instrument.setLoad(500)
    clock.advance(5)
    const d = await gql(yoga, `query { indication { value unit kind servedAt signature } }`) as {
      indication: { value: number; unit: string; servedAt: string; signature: ServeEnvelopeSignatureWire }
    }
    const q = d.indication
    const tampered = await verifyServeEnvelope(
      { endpoint: ENDPOINT, register: 'indication', value: q.value + 0.25, unit: q.unit, servedAt: q.servedAt },
      q.signature,
      await importVerifyKey(gen.publicKeySpki),
    )
    expect(tampered.ok).toBe(false)
  })

  it('the state serve stays a bare scalar — no envelope (the named limit)', async () => {
    const { yoga, clock } = await bootSigned()
    clock.advance(400) // past warm-up
    const d = await gql(yoga, `query { state }`) as { state: string }
    expect(d.state).toBe('ready')
  })

  it('the startup conformance gate stays green over the signed schema', async () => {
    const { schema } = await bootSigned()
    expect(checkTwinConformance(schema, LC500_CONTRACT)).toEqual([])
  })

  it('the default stays the legacy face: epoch servedAt, no signature member', async () => {
    const clock = new VirtualClock()
    const instrument = new SimulatedInstrument(getScenario('good-cell'), clock, 1)
    const schema = generateTwinSchema(LC500_CONTRACT, { instrument, clock })
    const yoga = createYoga({ schema, graphqlEndpoint: '/twin' })
    clock.advance(400)
    const d = await gql(yoga, `query { indication { value unit kind servedAt } }`) as {
      indication: { value: number; unit: string; kind: string; servedAt: number }
    }
    expect(typeof d.indication.servedAt).toBe('number')
    // Selecting the envelope against the legacy schema is a graphql
    // error — the member exists only under the signed posture.
    const withSig = await gqlFull(yoga, `query { indication { value signature } }`)
    expect(withSig.errors).toBeDefined()
  })
})
