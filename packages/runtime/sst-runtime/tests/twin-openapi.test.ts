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

import { describe, it, expect, afterEach, afterAll } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn, type ChildProcess } from 'node:child_process'
import { parse as parseYaml } from 'yaml'
import { loadPackage } from '../src/package-loader.js'
import { runSession, type Session } from '../src/session.js'
import { generateTwinOpenApi, checkOpenApiConformance, FRESH_WITHIN_HEADER } from '../src/twin-openapi.js'
import { LC500_CONTRACT, LC500_FULL_MODEL, withModel, type TwinContract } from '../src/twin-contract.js'
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

// ── The composite legs (specs/13 + §12 §5.5) ─────────────────────────
//
// The composite boot assembles its contract from the package's
// decomposition (loadCompositeContract's synthesis — one serve per
// decomposition target) and projects it to OpenAPI exactly as the
// single-instrument boot does: one GET /registers/<target> per
// register, the composite's FLAT namespace (no per-instrument path
// prefixes — the decomposition map is the composite's addressing, the
// same names the composite Query fields carry). What the
// single-instrument projection cannot infer from the target names, the
// boot declares per serve, derived from the source components'
// contracts: the computed composite state is a bare string, an
// Environment serve under a camelCase spelling is the Environment
// object, and each register inherits its source component's signed
// posture (a composite may mix signing and unsigned components).

/** The contract shape the composite boot synthesizes from the real
 *  acme-cgm-system package's decomposition (the library package ships
 *  no baked composite.twin.json — loadCompositeContract synthesizes). */
const CGM_SYSTEM_CONTRACT: TwinContract = {
  instrumentId: 'acme-cgm-system',
  serves: [
    { target: 'indicationCo', via: 'get_indicationCo', freshWithinS: 5 },
    { target: 'indicationNox', via: 'get_indicationNox', freshWithinS: 5 },
    { target: 'state', via: 'get_state', freshWithinS: 1 },
    { target: 'environmentalContext', via: 'get_environmentalContext', freshWithinS: 5 },
    { target: 'sampleFlow', via: 'get_sampleFlow', freshWithinS: 5 },
    { target: 'linePressure', via: 'get_linePressure', freshWithinS: 5 },
    { target: 'sampleTemperature', via: 'get_sampleTemperature', freshWithinS: 5 },
    { target: 'transportDelay', via: 'get_transportDelay', freshWithinS: 5 },
    { target: 'operationalState', via: 'get_operationalState', freshWithinS: 1 },
  ],
  operations: [],
}

/** The overrides the composite boot derives from the decomposition +
 *  the source components' contracts (compositeServeSchemas). */
const CGM_SERVE_SCHEMAS = {
  environmentalContext: { $ref: '#/components/schemas/Environment' },
  operationalState: { type: 'string', description: 'The computed composite state (the declared state rule).' },
}

describe('the composite OpenAPI projection (generated from the assembled contract)', () => {
  it('emits the flat register namespace: one GET per decomposition target, no per-instrument prefixes', () => {
    const doc = generateTwinOpenApi(CGM_SYSTEM_CONTRACT, { serveSchemas: CGM_SERVE_SCHEMAS }) as unknown as Doc
    expect(doc.openapi).toBe('3.1.0')
    expect(Object.keys(doc.paths).sort()).toEqual([
      '/registers/environmentalContext',
      '/registers/indicationCo',
      '/registers/indicationNox',
      '/registers/linePressure',
      '/registers/operationalState',
      '/registers/sampleFlow',
      '/registers/sampleTemperature',
      '/registers/state',
      '/registers/transportDelay',
      '/stream',
    ])
    // The computed composite state projects to a bare string; the
    // Environment serve keeps its object shape under the composite's
    // camelCase spelling; a quantity register keeps ServedQuantity.
    const schemaOf = (p: string) => (doc.paths[p]!['get']! as unknown as {
      responses: { '200': { content: { 'application/json': { schema: unknown } } } }
    }).responses['200'].content['application/json'].schema
    expect(schemaOf('/registers/operationalState')).toEqual({ type: 'string', description: 'The computed composite state (the declared state rule).' })
    expect(schemaOf('/registers/environmentalContext')).toEqual({ $ref: '#/components/schemas/Environment' })
    expect(schemaOf('/registers/state')).toEqual({ type: 'string', description: 'The operational state.' })
    expect(schemaOf('/registers/indicationCo')).toEqual({ $ref: '#/components/schemas/ServedQuantity' })
    // The freshness bound rides as the response header.
    const headers = (doc.paths['/registers/indicationCo']!['get']! as unknown as {
      responses: { '200': { headers: Record<string, unknown> } }
    }).responses['200'].headers
    expect(headers[FRESH_WITHIN_HEADER]).toBeDefined()
  })

  it('per-component signing: each register inherits its source component\'s posture', () => {
    // The analyzer signs, the sampling line does not (a mixed composite):
    // only the analyzer-sourced quantity registers answer the signed shape.
    const signedTargets = new Set(['indicationCo', 'indicationNox'])
    const doc = generateTwinOpenApi(CGM_SYSTEM_CONTRACT, {
      signedTargets,
      serveSchemas: CGM_SERVE_SCHEMAS,
    }) as unknown as Doc
    const schemaOf = (p: string) => (doc.paths[p]!['get']! as unknown as {
      responses: { '200': { content: { 'application/json': { schema: unknown } } } }
    }).responses['200'].content['application/json'].schema
    expect(schemaOf('/registers/indicationCo')).toEqual({ $ref: '#/components/schemas/SignedServedQuantity' })
    expect(schemaOf('/registers/indicationNox')).toEqual({ $ref: '#/components/schemas/SignedServedQuantity' })
    expect(schemaOf('/registers/sampleFlow')).toEqual({ $ref: '#/components/schemas/ServedQuantity' })
    // The envelope components appear (a signing component exists); the
    // computed state stays a bare string even under a signing analyzer.
    expect(doc.components.schemas['ServeSignature']).toBeDefined()
    expect(doc.components.schemas['SignedServedQuantity']).toBeDefined()
    expect(schemaOf('/registers/operationalState')).toEqual({ type: 'string', description: 'The computed composite state (the declared state rule).' })
  })

  it('the startup conformance gate is green over the generated composite document, and loud on drift', () => {
    const doc = generateTwinOpenApi(CGM_SYSTEM_CONTRACT, { serveSchemas: CGM_SERVE_SCHEMAS }) as unknown as Record<string, unknown>
    expect(checkOpenApiConformance(doc, CGM_SYSTEM_CONTRACT)).toEqual([])

    // A serve the document does not carry.
    const tampered = {
      ...CGM_SYSTEM_CONTRACT,
      serves: [...CGM_SYSTEM_CONTRACT.serves, { target: 'groundTruth', via: 'get_groundTruth', freshWithinS: 5 }],
    }
    expect(checkOpenApiConformance(doc, tampered).join(' ')).toContain('groundTruth')

    // A document path the composite contract never declared (a
    // per-instrument escape hatch would be exactly this drift).
    const drifted = generateTwinOpenApi(CGM_SYSTEM_CONTRACT, { serveSchemas: CGM_SERVE_SCHEMAS }) as { paths: Record<string, unknown> }
    drifted.paths['/registers/analyzer/indication_co'] = { get: {} }
    expect(checkOpenApiConformance(drifted as unknown as Record<string, unknown>, CGM_SYSTEM_CONTRACT).join(' '))
      .toContain('/registers/analyzer/indication_co')
  })
})

// The live composite leg boots via the CLI as a SUBPROCESS — the vitest
// module loader's graphql realm collision (see composite-runtime.test.ts's
// header) never applies to a real process. Two honest skips, per the
// declaration doctrine: the instrument library undeclared
// (SST_LIBRARY_PATH unset), and (for the signed boot) the library's
// component manifests carrying no signing: blocks.
const RUNTIME_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const LIB = process.env.SST_LIBRARY_PATH
const COMPOSITE_DIR = LIB ? join(LIB, 'packages', 'instances', 'acme-cgm-system') : null
const HAS_COMPOSITE = COMPOSITE_DIR !== null && existsSync(join(COMPOSITE_DIR, 'package.sst.yaml'))

function componentSigning(instance: string): ServeSigningDecl | undefined {
  if (!LIB) return undefined
  const manifestPath = join(LIB, 'packages', 'instances', instance, 'package.sst.yaml')
  if (!existsSync(manifestPath)) return undefined
  const manifest = parseYaml(readFileSync(manifestPath, 'utf-8')) as { signing?: ServeSigningDecl }
  return manifest.signing
}

const ANALYZER_SIGNING = componentSigning('acme-cgm-200')
const LINE_SIGNING = componentSigning('acme-cgm-sampling-line')
const HAS_SIGNING = ANALYZER_SIGNING !== undefined && LINE_SIGNING !== undefined

const children: ChildProcess[] = []
afterAll(() => {
  for (const c of children.splice(0)) c.kill('SIGTERM')
})

/** Boot the composite via the CLI (the user face), wait for /twin. */
async function bootComposite(port: number, env: Record<string, string>): Promise<string> {
  const child = spawn('npx', ['tsx', 'src/bin.ts', 'run', COMPOSITE_DIR!, String(port)], {
    cwd: RUNTIME_DIR,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  children.push(child)
  let log = ''
  child.stdout?.on('data', d => { log += String(d) })
  child.stderr?.on('data', d => { log += String(d) })
  const url = `http://localhost:${port}`
  const deadline = Date.now() + 60_000
  for (;;) {
    try {
      const res = await fetch(`${url}/twin`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: '{ operationalState }' }),
      })
      if (res.ok) return url
    } catch { /* not up yet */ }
    if (Date.now() > deadline) {
      throw new Error(`the composite did not boot within 60s — the CLI log:\n${log}`)
    }
    if (child.exitCode !== null) {
      throw new Error(`the composite exited (${child.exitCode}) during boot — the CLI log:\n${log}`)
    }
    await new Promise(r => setTimeout(r, 500))
  }
}

describe('a REST client against a booted composite (the acme-cgm-system, CLI boot)', () => {
  if (!HAS_COMPOSITE) {
    it.skip('needs the instrument library (set SST_LIBRARY_PATH to the oimlsmart/sst checkout)', () => {})
    return
  }

  it('serves the generated document at /openapi.json and answers REST register reads', async () => {
    const base = await bootComposite(5496, {})

    // The discovery act: the composite's document, generated from its
    // assembled contract — the flat register namespace.
    const docRes = await fetch(`${base}/openapi.json`)
    expect(docRes.status).toBe(200)
    const doc = await docRes.json() as Doc & { servers: { url: string }[] }
    expect(doc.openapi).toBe('3.1.0')
    for (const target of [
      'indicationCo', 'indicationNox', 'state', 'environmentalContext',
      'sampleFlow', 'linePressure', 'sampleTemperature', 'transportDelay', 'operationalState',
    ]) {
      expect(doc.paths[`/registers/${target}`], `the document carries /registers/${target}`).toBeDefined()
    }

    // The REST reads bind to the SAME readers the composite GraphQL
    // resolvers use: a quantity register answers the ServedQuantity
    // shape with the freshness header, the computed composite state
    // answers a bare string, an undeclared register is a 404.
    const twin = `${base}${doc.servers[0]!.url}`
    const coRes = await fetch(`${twin}/registers/indicationCo`)
    expect(coRes.status).toBe(200)
    expect(coRes.headers.get(FRESH_WITHIN_HEADER)).toBe('5')
    const co = await coRes.json() as { value: number; unit: string; servedAt: number }
    expect(co.value).toBeTypeOf('number')
    expect(co.unit).toBe('ppm')
    expect(co.servedAt).toBeTypeOf('number')

    const stateRes = await fetch(`${twin}/registers/operationalState`)
    expect(stateRes.status).toBe(200)
    expect(await stateRes.json()).toBeTypeOf('string')

    const flowRes = await fetch(`${twin}/registers/sampleFlow`)
    expect(flowRes.status).toBe(200)

    const miss = await fetch(`${twin}/registers/ground_truth`)
    expect(miss.status).toBe(404)
  }, 90_000)

  it('the signed boot: the document types each register by its source component\'s posture, the REST read verifies', async () => {
    if (!HAS_SIGNING) {
      console.log('skip: the library\'s component manifests carry no signing: blocks yet')
      return
    }
    const base = await bootComposite(5495, { SST_SIGNED_SERVE: '1' })

    const doc = await (await fetch(`${base}/openapi.json`)).json() as Doc & { servers: { url: string }[] }
    expect(doc.components.schemas['ServeSignature']).toBeDefined()
    const schemaOf = (p: string) => (doc.paths[p]!['get']! as unknown as {
      responses: { '200': { content: { 'application/json': { schema: unknown } } } }
    }).responses['200'].content['application/json'].schema
    // Both components sign here — quantity registers answer the signed
    // shape; the computed state stays a bare string.
    expect(schemaOf('/registers/indicationCo')).toEqual({ $ref: '#/components/schemas/SignedServedQuantity' })
    expect(schemaOf('/registers/sampleFlow')).toEqual({ $ref: '#/components/schemas/SignedServedQuantity' })
    expect(schemaOf('/registers/operationalState')).toEqual({ type: 'string', description: 'The computed composite state (the declared state rule).' })

    // The REST read carries the COMPONENT's envelope (the analyzer signs
    // endpoint cgm_api register indication_co), verifiable against the
    // package-committed public key.
    const twin = `${base}${doc.servers[0]!.url}`
    const coRes = await fetch(`${twin}/registers/indicationCo`)
    expect(coRes.status).toBe(200)
    const co = await coRes.json() as {
      value: number; unit: string; servedAt: string; signature: ServeEnvelopeSignatureWire
    }
    expect(co.servedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
    expect(co.signature.endpoint).toBe(ANALYZER_SIGNING!.endpoint)
    expect(co.signature.register).toBe('indication_co')
    const v = await verifyServeEnvelope(
      { endpoint: co.signature.endpoint, register: co.signature.register, value: co.value, unit: co.unit, servedAt: co.servedAt },
      co.signature,
      await importVerifyKey(ANALYZER_SIGNING!.public_key_spki),
    )
    expect(v).toEqual({ ok: true })
  }, 90_000)
})
