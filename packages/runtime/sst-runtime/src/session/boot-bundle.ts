// session/boot-bundle.ts — boot a session from an already-resolved
// package bundle (no filesystem).
//
// The FS boot (session/boot.ts) resolves the instance's files from
// disk: the manifest, coefficients, the sample, the kind's SDL/YAML/
// handlers/mpe/physics-chain, the baked twin contract, and the
// behavior.js (dynamic import). A bundle-native host (the Cloudflare
// Worker adapter) cannot touch the filesystem — it carries those same
// inputs as bundled imports and hands them to THIS boot.
//
// The contract: the same inputs → the same session. Every step here is
// the FS boot's step with the read replaced by a bundled value; the
// shared pure cores (definition-builder's parts builder, the world-kind
// composer, the mpe translation, the baked-contract unwrapping, the
// behavior validation) are THE SAME functions the FS path calls, so the
// two transports cannot drift. The parity tests pin it per route.

import { parse as parseYaml } from 'yaml'
import type { GraphQLSchema } from 'graphql'
import type { PackageManifest } from '../package-loader.js'
import { VirtualClock } from '../time.js'
import { buildWorldSchemaFor, type WorldContext, type WorldKind } from '../world-schema.js'
import { generateTwinSchema, type TwinIo } from '../twin-schema.js'
import { checkTwinConformance } from '../conformance.js'
import { generateTwinOpenApi, checkOpenApiConformance } from '../twin-openapi.js'
import { loadBakedContractFromArtifact } from '../twin-bake.js'
import { buildTwinIo } from '../kinds/twin-io-builder.js'
import { buildDefinitionFromParts } from '../kinds/definition-builder.js'
import { composeWorldKindFromSources } from '../kinds/world-schema-assembler.js'
import { behaviorFromModule, type LoadedBehavior } from '../kinds/behavior-loader.js'
import { parsePhysicsChainText, type InstanceClassification } from '../stages/data-driven.js'
import { enrichContractWithModel, flattenCoefficients, readTwinTarget, resolveBootSigning } from './boot.js'
import type { TwinContract, InstrumentModel } from '../twin-contract.js'
import type { ServeSigningDecl, ServeSigning } from '../twin/serve-signing.js'

/** The kind's mutation-handler signature (the world handlers' shape,
 *  untyped here — the bundle carries them as functions). */
export type BundleHandler = (ctx: WorldContext<never, never>, args: Record<string, unknown>) => void

/** A resolved instance+kind bundle: everything the FS boot would read,
 *  carried as values. The texts are the SAME files (the bundler embeds
 *  them verbatim); `behaviorModule` is the imported behavior.js. */
export interface SessionBundle {
  instance: {
    manifest: PackageManifest
    /** coefficients.yaml text (the manifest's `coefficients:` file). */
    coefficientsYaml: string
    /** The resolved sample's YAML text — the FS path's
     *  loadDefaultSample/loadSample resolution happens at bundling
     *  time (prefer `fresh`, else the first listed). */
    sampleYaml?: string
    /** The requested sample ref (the definition's fallback name). */
    sampleRef?: string
  }
  kind: {
    /** world-kind.sdl.graphql text. */
    worldKindSdl: string
    /** world-kind.yaml text (the mutation → handler mapping). */
    worldKindYaml: string
    /** The handlers module's `handlers` export. */
    handlers: Record<string, BundleHandler>
    /** The scenario registry (the FS behavior path passes {} — same
     *  default here; a bundler MAY embed the kind's scenarios). */
    scenarios?: WorldKind<never, never>['scenarios']
    /** The baked twin contract artifact (twin/<kind>.twin.json). */
    twinContractJson: unknown
    /** The kind's mpe.yaml text (absent → no metrological limits). */
    mpeYaml?: string
    /** The kind's physics-chain.yaml text (absent → behavior default). */
    physicsChainYaml?: string
  }
  /** The imported behavior module (behavior.js). */
  behaviorModule: unknown
}

export interface BundleSessionOptions {
  seed?: number
  /** The signed-serve posture (spec §12): a programmatic declaration
   *  ACTIVATES directly (a deployment act); the manifest's `signing:`
   *  block activates when `signedServe` is true (the env knob's
   *  bundle-native face). */
  signing?: ServeSigningDecl
  signedServe?: boolean
}

/** A booted bundle session: the schemas + readers the HTTP surface
 *  serves. No server — the host (the worker adapter, a test) owns the
 *  transport. */
export interface BundleSession {
  instanceId: string
  kindId: string
  /** The landing-page title block (same shape the FS boot passes). */
  title: string
  contract: TwinContract & { model: InstrumentModel }
  twinIo: TwinIo
  twinSchema: GraphQLSchema
  worldSchema: GraphQLSchema
  openApiDoc: Record<string, unknown>
  instrument: unknown
  clock: VirtualClock
  signing: ServeSigning | undefined
  stream: {
    targets: string[]
    read: (target: string) => unknown
  }
}

/** Boot a session from a bundle. The bundle-native mirror of
 *  bootSession: same order, same checks, same pure cores — only the
 *  reads are gone. */
export async function bootBundleSession(
  bundle: SessionBundle,
  opts: BundleSessionOptions = {},
): Promise<BundleSession> {
  const manifest = bundle.instance.manifest
  if (manifest.tier !== 'primmel-instance') {
    throw new Error(`bootBundleSession targets an instance package; got tier '${manifest.tier}'`)
  }
  if (!manifest.kind) {
    throw new Error(`instance package '${manifest.id}' has no 'kind' reference`)
  }

  // 1. The instance's classification + coefficients (the FS path's
  //    readCoefficients → flattenCoefficients).
  const classification = (manifest.classification ?? {}) as InstanceClassification
  const coefficients = flattenCoefficients(parseYaml(bundle.instance.coefficientsYaml) as Parameters<typeof flattenCoefficients>[0])

  // 2. The sample (resolved at bundling time) + its serial.
  const sampleData = bundle.instance.sampleYaml != null
    ? (parseYaml(bundle.instance.sampleYaml) as Parameters<typeof buildDefinitionFromParts>[0]['sampleData'])
    : undefined

  // 3. The kind's physics-chain declaration (same parse the FS path runs).
  const physicsChain = bundle.kind.physicsChainYaml != null
    ? parsePhysicsChainText(bundle.kind.physicsChainYaml, `bundle://${manifest.kind}/physics-chain.yaml`)
    : undefined

  // 4. The behavior (validated by the SAME module validator the FS
  //    loader applies after its dynamic import).
  const behavior: LoadedBehavior = behaviorFromModule(
    bundle.behaviorModule,
    `bundle://${manifest.id}/behavior.js`,
  )

  // 5. The definition (the same parts builder the FS path calls).
  const def = buildDefinitionFromParts({
    manifest,
    coefficients,
    classification: classification as Record<string, string | undefined>,
    ...(sampleData ? { sampleData } : {}),
    ...(physicsChain ? { physicsChain } : {}),
    ...(bundle.instance.sampleRef ? { sampleRef: bundle.instance.sampleRef } : {}),
  })

  const clock = new VirtualClock()
  const seed = opts.seed ?? 42
  const instrument: unknown = behavior.create(def, clock, seed)
  if (instrument == null || typeof instrument !== 'object') {
    throw new Error(
      `bootBundleSession: behavior.create() returned ${instrument === null ? 'null' : typeof instrument} — expected an instrument object`,
    )
  }
  for (const method of ['servedAt', 'operationalState'] as const) {
    if (typeof (instrument as Record<string, unknown>)[method] !== 'function') {
      throw new Error(
        `bootBundleSession: behavior produced an instrument missing ${method}() — ` +
        `the kind's interface requires the TwinInstrumentView surface`,
      )
    }
  }

  // 6. The /world schema (the same composer the FS path calls).
  const mapping = parseYaml(bundle.kind.worldKindYaml) as { mutations: Record<string, { handler: string }> }
  const worldKind = composeWorldKindFromSources<never, never>({
    sdl: bundle.kind.worldKindSdl,
    mapping,
    handlers: bundle.kind.handlers as Record<string, (ctx: WorldContext<never, never>, args: Record<string, unknown>) => void>,
    scenarios: bundle.kind.scenarios ?? ({} as WorldKind<never, never>['scenarios']),
  })
  const host = {
    instrument,
    clock,
    swap() { /* scenarios are not swappable when behavior owns the instrument */ },
  }
  const worldSchema = buildWorldSchemaFor(host as unknown as WorldContext<never, never>, worldKind)

  // 7. The /twin schema (baked contract → enrichment → generation →
  //    conformance, exactly the FS path's steps).
  const baseContract = loadBakedContractFromArtifact(
    bundle.kind.twinContractJson as Parameters<typeof loadBakedContractFromArtifact>[0],
    `bundle://${manifest.kind}/twin-contract`,
  )
  let contract = enrichContractWithModel(baseContract, manifest, bundle.kind.mpeYaml)
  const serial = sampleData?.serial_number
  if (serial) contract.model.identification.serial = serial

  const signing = await resolveBundleSigning(manifest.signing, opts)
  const twinIo = buildTwinIo(instrument, clock, contract, behavior, signing)

  const twinSchema = generateTwinSchema(contract, twinIo)
  const diffs = checkTwinConformance(twinSchema, contract)
  if (diffs.length > 0) {
    throw new Error(`twin conformance check FAILED for instance '${manifest.id}':\n  - ${diffs.join('\n  - ')}`)
  }

  const openApiDoc = generateTwinOpenApi(contract, { signed: signing != null })
  const openApiDiffs = checkOpenApiConformance(openApiDoc, contract)
  if (openApiDiffs.length > 0) {
    throw new Error(`twin OpenAPI conformance check FAILED for instance '${manifest.id}':\n  - ${openApiDiffs.join('\n  - ')}`)
  }

  return {
    instanceId: manifest.id,
    kindId: manifest.kind,
    title: `${manifest.title} (SST)`,
    contract: contract as TwinContract & { model: InstrumentModel },
    twinIo,
    twinSchema,
    worldSchema,
    openApiDoc,
    instrument,
    clock,
    signing,
    stream: {
      targets: contract.serves.map((s) => s.target),
      read: (target: string) => readTwinTarget(target, instrument, twinIo),
    },
  }
}

/** The signing resolution (the FS path's resolveBootSigning with the
 *  env knob carried as an explicit option — a worker has no process.env
 *  to read). */
async function resolveBundleSigning(
  manifestDecl: ServeSigningDecl | undefined,
  opts: BundleSessionOptions,
): Promise<ServeSigning | undefined> {
  const decl = opts.signing ?? (opts.signedServe ? manifestDecl : undefined)
  return decl ? resolveBootSigning(decl, undefined) : undefined
}
