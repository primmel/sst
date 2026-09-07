// tests/composite-signed-serve.test.ts — the composite-sim scenario
// for the signed-serve posture (spec §12 + §13): the REAL
// acme-cgm-system composite booted via the CLI with SST_SIGNED_SERVE=1,
// both components signing from their manifest declarations — the smart
// platform's composite signed-serve consumption (its
// compositeIntegrations `signatures` option) has a real producer to
// verify against.
//
//   the signed serves — the composite's indicationCo / sampleFlow carry
//              each COMPONENT's envelope (the analyzer signs
//              endpoint cgm_api register indication_co; the sampling
//              line signs endpoint sample_line_api register
//              sample.test_context.flow — the DECLARED aspect spelling
//              override), verified byte-exact against the PUBLIC KEYS
//              THE LIBRARY PACKAGES COMMIT;
//   the tamper leg — a modified value / a replay under the other
//              channel / the wrong component's key all verify FALSE
//              (the composite's cryptographic floor);
//   the default leg — the same packages booted WITHOUT the env serve
//              the legacy face (epoch servedAt, no signature member):
//              the committed blocks alone never change the bytes.
//
// TWO honest skips, per the declaration doctrine:
//   1. the instrument library undeclared (SST_LIBRARY_PATH unset);
//   2. the library's component manifests carrying no signing: blocks
//      (the library predates the signed-serve declarations — the leg
//      activates when the library lane lands).
//
// The composite boots via the CLI as a SUBPROCESS (the vitest module
// loader's graphql realm collision — see composite-runtime.test.ts's
// header — never applies to a real process; the CLI IS the user face).

import { describe, it, expect, afterAll } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn, type ChildProcess } from 'node:child_process'
import { parse as parseYaml } from 'yaml'
import {
  importVerifyKey,
  verifyServeEnvelope,
  type ServeEnvelopeSignatureWire,
  type ServeSigningDecl,
} from '../src/twin/serve-signing.js'

const RUNTIME_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const LIB = process.env.SST_LIBRARY_PATH
const COMPOSITE_DIR = LIB ? join(LIB, 'packages', 'instances', 'acme-cgm-system') : null

/** The component manifests' signing declarations (undefined members ⇒
 *  the library predates the signed-serve lane — the honest skip). */
function componentSigning(instance: string): ServeSigningDecl | undefined {
  if (!LIB) return undefined
  const manifestPath = join(LIB, 'packages', 'instances', instance, 'package.sst.yaml')
  if (!existsSync(manifestPath)) return undefined
  const manifest = parseYaml(readFileSync(manifestPath, 'utf-8')) as { signing?: ServeSigningDecl }
  return manifest.signing
}

const ANALYZER_SIGNING = componentSigning('acme-cgm-200')
const LINE_SIGNING = componentSigning('acme-cgm-sampling-line')
const HAS_LIBRARY = COMPOSITE_DIR !== null && existsSync(join(COMPOSITE_DIR, 'package.sst.yaml'))
const HAS_SIGNING = ANALYZER_SIGNING !== undefined && LINE_SIGNING !== undefined

interface ServedQuantityBody {
  value: number
  unit: string
  kind: string
  servedAt: string
  signature: ServeEnvelopeSignatureWire
}

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
  const url = `http://localhost:${port}/twin`
  const deadline = Date.now() + 60_000
  for (;;) {
    try {
      const res = await fetch(url, {
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

async function gql(url: string, query: string): Promise<{ data?: Record<string, unknown>; errors?: Array<{ message: string }> }> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query }),
  })
  return (await res.json()) as { data?: Record<string, unknown>; errors?: Array<{ message: string }> }
}

describe('the composite signed serve (the CLI boot, SST_SIGNED_SERVE=1)', () => {
  if (!HAS_LIBRARY) {
    it.skip('needs the instrument library (set SST_LIBRARY_PATH to the oimlsmart/sst checkout)', () => {})
    return
  }
  if (!HAS_SIGNING) {
    it.skip('the library\'s component manifests carry no signing: blocks yet (the oimlsmart/sst signed-serve lane lands them)', () => {})
    return
  }

  it('both components\' serves carry envelopes verifying against the PACKAGE-COMMITTED public keys', async () => {
    const twin = await bootComposite(5499, { SST_SIGNED_SERVE: '1' })

    const co = (await gql(twin, '{ indicationCo { value unit kind servedAt signature } }'))
      .data?.['indicationCo'] as ServedQuantityBody
    expect(co.value).toBeTypeOf('number')
    expect(co.unit).toBe('ppm')
    expect(co.servedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
    expect(new Date(Date.parse(co.servedAt)).toISOString()).toBe(co.servedAt)
    expect(co.signature.endpoint).toBe(ANALYZER_SIGNING!.endpoint)
    expect(co.signature.register).toBe('indication_co')
    expect(co.signature.key_id).toBe(ANALYZER_SIGNING!.key_id)
    expect(co.signature.public_key_spki).toBe(ANALYZER_SIGNING!.public_key_spki)
    const coVerify = await verifyServeEnvelope(
      { endpoint: co.signature.endpoint, register: co.signature.register, value: co.value, unit: co.unit, servedAt: co.servedAt },
      co.signature,
      await importVerifyKey(ANALYZER_SIGNING!.public_key_spki),
    )
    expect(coVerify).toEqual({ ok: true })

    const flow = (await gql(twin, '{ sampleFlow { value unit kind servedAt signature } }'))
      .data?.['sampleFlow'] as ServedQuantityBody
    expect(flow.signature.endpoint).toBe(LINE_SIGNING!.endpoint)
    // The DECLARED aspect spelling (the R 144 model's), not the
    // internal serve target — the manifest's registers override.
    expect(flow.signature.register).toBe('sample.test_context.flow')
    const flowVerify = await verifyServeEnvelope(
      { endpoint: flow.signature.endpoint, register: flow.signature.register, value: flow.value, unit: flow.unit, servedAt: flow.servedAt },
      flow.signature,
      await importVerifyKey(LINE_SIGNING!.public_key_spki),
    )
    expect(flowVerify).toEqual({ ok: true })

    // The computed composite state stays a bare scalar (the named limit).
    const state = await gql(twin, '{ operationalState }')
    expect(state.data?.['operationalState']).toBeTypeOf('string')
  }, 90_000)

  it('TAMPER: a modified value, a replayed channel, or the wrong component key verifies FALSE', async () => {
    const twin = await bootComposite(5498, { SST_SIGNED_SERVE: '1' })
    const co = (await gql(twin, '{ indicationCo { value unit kind servedAt signature } }'))
      .data?.['indicationCo'] as ServedQuantityBody
    const key = await importVerifyKey(ANALYZER_SIGNING!.public_key_spki)

    const tamperedValue = await verifyServeEnvelope(
      { endpoint: co.signature.endpoint, register: co.signature.register, value: co.value + 1, unit: co.unit, servedAt: co.servedAt },
      co.signature,
      key,
    )
    expect(tamperedValue.ok).toBe(false)

    const replayedChannel = await verifyServeEnvelope(
      { endpoint: LINE_SIGNING!.endpoint, register: co.signature.register, value: co.value, unit: co.unit, servedAt: co.servedAt },
      co.signature,
      key,
    )
    expect(replayedChannel.ok).toBe(false)

    const wrongKey = await verifyServeEnvelope(
      { endpoint: co.signature.endpoint, register: co.signature.register, value: co.value, unit: co.unit, servedAt: co.servedAt },
      co.signature,
      await importVerifyKey(LINE_SIGNING!.public_key_spki),
    )
    expect(wrongKey.ok).toBe(false)
  }, 90_000)

  it('the default leg: the same packages WITHOUT the env serve the legacy face', async () => {
    const twin = await bootComposite(5497, {})
    const d = await gql(twin, '{ indicationCo { value unit kind servedAt } }')
    const co = d.data?.['indicationCo'] as { servedAt: unknown }
    expect(typeof co.servedAt).toBe('number')
    const withSig = await gql(twin, '{ indicationCo { value signature } }')
    expect(withSig.errors).toBeDefined()
  }, 90_000)
})
