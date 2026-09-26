// tests/twin-openapi.test.ts — the OpenAPI leg of the twin contract
// (the smart platform's TODO.twin-demo/06; spec §12 §5.5):
//
//   the generation leg — an OpenAPI 3.1 document generated from the
//              LC-500 contract: one GET per serve, one POST per
//              command, GET /instrument for the model mirror, GET
//              /stream for the SSE channel; never hand-written;
//   the conformance leg — checkOpenApiConformance green over the
//              generated document, and loud on drift (a serve or a
//              command the document does not carry);
//   the signed leg — under the signed-serve posture the document
//              carries the ServeSignature envelope as a first-class
//              component and SignedServedQuantity requires it;
//   the live leg — a REST client generated FROM the served document
//              reads the indication and runs the self test against a
//              booted LC-500, with the signed-serve verification
//              exercised (the acceptance's own shape).

import { describe, it, expect, afterEach } from 'vitest'
import { loadPackage } from '../src/package-loader.js'
import { runSession, type Session } from '../src/session.js'
import { generateTwinOpenApi, checkOpenApiConformance, FRESH_WITHIN_HEADER } from '../src/twin-openapi.js'
import { LC500_CONTRACT, LC500_FULL_MODEL, withModel } from '../src/twin-contract.js'
import {
  generateSigningKey,
  importVerifyKey,
  verifyServeEnvelope,
  type ServeEnvelopeSignatureWire,
  type ServeSigningDecl,
} from '../src/twin/serve-signing.js'

import { instancePath } from './lib.js'
const ACME_LC500 = instancePath('acme-lc500')

const ENRICHED = withModel(LC500_CONTRACT, LC500_FULL_MODEL)

type Doc = {
  openapi: string
  paths: Record<string, Record<string, { operationId?: string }>>
  components: { schemas: Record<string, Record<string, unknown>> }
}

describe('the OpenAPI projection (generated from the contract)', () => {
  it('emits a valid 3.1 document: one path per serve, one per command, /instrument and /stream', () => {
    const doc = generateTwinOpenApi(ENRICHED) as unknown as Doc
    expect(doc.openapi).toBe('3.1.0')
    expect(Object.keys(doc.paths).sort()).toEqual([
      '/instrument',
      '/operations/run_self_test',
      '/registers/indication',
      '/registers/state',
      '/stream',
    ])
    // The serve's freshness bound is a first-class response header.
    const indication = doc.paths['/registers/indication']!['get']!
    expect(indication.operationId).toBe('get_indication')
    const headers = (indication as unknown as { responses: { '200': { headers: Record<string, unknown> } } })
      .responses['200'].headers
    expect(headers[FRESH_WITHIN_HEADER]).toBeDefined()
    // The unsigned face: ServedQuantity carries no envelope member.
    expect(doc.components.schemas['SignedServedQuantity']).toBeUndefined()
    expect(doc.components.schemas['ServeSignature']).toBeUndefined()
  })

  it('omits /instrument when the contract carries no model', () => {
    const doc = generateTwinOpenApi(LC500_CONTRACT) as unknown as Doc
    expect(doc.paths['/instrument']).toBeUndefined()
    expect(checkOpenApiConformance(doc as unknown as Record<string, unknown>, LC500_CONTRACT)).toEqual([])
  })

  it('the startup conformance gate is green over the generated document, and loud on drift', () => {
    const doc = generateTwinOpenApi(ENRICHED) as unknown as Record<string, unknown>
    expect(checkOpenApiConformance(doc, ENRICHED)).toEqual([])

    // A serve the document does not carry.
    const tampered = {
      ...ENRICHED,
      serves: [...ENRICHED.serves, { target: 'indication_so2', via: 'get_indication', freshWithinS: 5 }],
    }
    expect(checkOpenApiConformance(doc, tampered).join(' ')).toContain('indication_so2')

    // A document path the contract never declared.
    const drifted = generateTwinOpenApi(ENRICHED) as { paths: Record<string, unknown> }
    drifted.paths['/registers/ground_truth'] = { get: {} }
    expect(checkOpenApiConformance(drifted as unknown as Record<string, unknown>, ENRICHED).join(' ')).toContain('ground_truth')
  })

  it('the signed posture: the envelope is a first-class component, the signed shape requires it', () => {
    const doc = generateTwinOpenApi(ENRICHED, { signed: true }) as unknown as Doc
    const sig = doc.components.schemas['ServeSignature']!
    expect(sig).toBeDefined()
    const signedQty = doc.components.schemas['SignedServedQuantity']! as {
      required: string[]
      properties: Record<string, unknown>
    }
    expect(signedQty.required).toContain('signature')
    expect(signedQty.properties['signature']).toEqual({ $ref: '#/components/schemas/ServeSignature' })
    // The indication serve answers the signed shape.
    const res = (doc.paths['/registers/indication']!['get']! as unknown as {
      responses: { '200': { content: { 'application/json': { schema: unknown } } } }
    }).responses['200'].content['application/json'].schema
    expect(res).toEqual({ $ref: '#/components/schemas/SignedServedQuantity' })
  })
})

describe('a REST client generated from the served document (a booted, signed LC-500)', () => {
  let session: Session | undefined
  afterEach(async () => {
    await session?.close()
    session = undefined
  })

  it('reads the indication with the signed-serve verification, and runs the self test', async () => {
    const gen = await generateSigningKey('lc500-unit-1-key-1')
    const decl: ServeSigningDecl = {
      endpoint: 'lc500_api',
      key_id: gen.keyId,
      public_key_spki: gen.publicKeySpki,
      private_key_pkcs8: gen.privateKeyPkcs8,
    }
    const pkg = await loadPackage(ACME_LC500)
    session = await runSession(pkg, { port: 0, seed: 42, signing: decl })

    // The discovery act: the document itself, served at /openapi.json.
    const docRes = await fetch(`${session.url}/openapi.json`)
    expect(docRes.status).toBe(200)
    const doc = await docRes.json() as Doc & { servers: { url: string }[] }
    expect(doc.openapi).toBe('3.1.0')
    expect(doc.components.schemas['ServeSignature']).toBeDefined()

    // The client is generated FROM the document: the base URL is the
    // declared server, the requests are the documented operations.
    const base = `${session.url}${doc.servers[0]!.url}`
    const indicationPath = Object.entries(doc.paths)
      .find(([, item]) => item['get']?.operationId === 'get_indication')![0]
    const selfTestPath = Object.entries(doc.paths)
      .find(([, item]) => item['post']?.operationId === 'run_self_test')![0]

    // Read the indication (the documented freshness header rides along).
    const regRes = await fetch(`${base}${indicationPath}`)
    expect(regRes.status).toBe(200)
    expect(regRes.headers.get(FRESH_WITHIN_HEADER)).toBe('5')
    const q = await regRes.json() as {
      value: number; unit: string; kind: string; servedAt: string; signature: ServeEnvelopeSignatureWire
    }
    expect(q.servedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
    const v = await verifyServeEnvelope(
      { endpoint: 'lc500_api', register: 'indication', value: q.value, unit: q.unit, servedAt: q.servedAt },
      q.signature,
      await importVerifyKey(gen.publicKeySpki),
    )
    expect(v).toEqual({ ok: true })
    const tampered = await verifyServeEnvelope(
      { endpoint: 'lc500_api', register: 'indication', value: q.value + 0.5, unit: q.unit, servedAt: q.servedAt },
      q.signature,
      await importVerifyKey(gen.publicKeySpki),
    )
    expect(tampered.ok).toBe(false)

    // Run the self test through the documented operation.
    const opRes = await fetch(`${base}${selfTestPath}`, { method: 'POST' })
    expect(opRes.status).toBe(200)
    const op = await opRes.json() as { state: string }
    expect(typeof op.state).toBe('string')

    // The instrument mirror answers the same object Query.instrument resolves to.
    const instRes = await fetch(`${base}/instrument`)
    expect(instRes.status).toBe(200)
    const inst = await instRes.json() as {
      identification: { instrumentId: string }
      servedRegisters: { target: string }[]
      legalOperations: { id: string }[]
    }
    expect(inst.identification.instrumentId).toBe('acme-lc500')
    expect(inst.servedRegisters.map(r => r.target)).toContain('indication')
    expect(inst.legalOperations.map(o => o.id)).toContain('run_self_test')

    // The world channel stays GraphQL-only: an undeclared register is a 404.
    const miss = await fetch(`${base}/registers/ground_truth`)
    expect(miss.status).toBe(404)
  }, 30_000)
})
