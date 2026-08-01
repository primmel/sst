// session/boot.ts — the actual session boot flow (TODO 24).
//
// Composes a base + kind + instance package into a running sim:
//   1. Read the instance's coefficients.yaml + classification.
//   2. Resolve the referenced kind's physics-chain.yaml.
//   3. Build a ComposedInstrument with the data-driven composer.
//   4. Build the /world schema (kind-specific — R 60 LOAD_CELL_WORLD_KIND).
//   5. Build the /twin schema (R 60 contract from the LC500 baked artifact).
//   6. Boot createSimServer.
//
// Status: production for R 60 instances; sibling kinds (R 91 / R 129 /
// R 144) need their own world-kind + twin-contract registrations.

import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse as parseYaml } from 'yaml'
import { VirtualClock } from '../time.js'
import { buildWorldSchema } from '../world-schema.js'
import { generateTwinSchema } from '../twin-schema.js'
import { checkTwinConformance } from '../conformance.js'
import { loadBakedContract } from '../twin-bake.js'
import { createSimServer } from '../server.js'
import { ComposedInstrument, type ComposedInstrumentConfig } from '../stages/composer.js'
import { loadPhysicsChain, type PhysicsChainDecl, type InstanceClassification } from '../stages/data-driven.js'
import type { LoadedPackage } from '../package-loader.js'
import type { Session, SessionOptions } from '../session.js'
import { lookupKind } from '../kinds/registry.js'
import { tryBootFromBehavior } from '../kinds/boot-from-behavior.js'
import { buildTwinIo } from '../kinds/twin-io-builder.js'
import type { TwinContract, InstrumentModel, ModelQuantity, DesignParameters, MetrologicalLimits } from '../twin-contract.js'
import { parseMpeConfig } from '../certification/verdict.js'

// ── Path resolution ───────────────────────────────────────────────────

// boot.ts lives at packages/runtime/sst-runtime/src/session/boot.ts.
// SESSION_DIR = .../session; REPO_ROOT climbs 5 levels from there.
const SESSION_DIR = resolve(fileURLToPath(import.meta.url), '..')
const REPO_ROOT = resolve(SESSION_DIR, '..', '..', '..', '..', '..')
const DEFAULT_KINDS_DIR = join(REPO_ROOT, 'packages', 'kinds')
const DEFAULT_INSTANCES_DIR = join(REPO_ROOT, 'packages', 'instances')

function kindDir(kindId: string, packagesDir: string): string {
  // 'primmel-sst-r60' → 'sst-r60'
  const folder = kindId.replace(/^primmel-/, '')
  return join(packagesDir, folder)
}

/** Map each kind to its baked twin contract artifact. Each kind package
 *  ships its twin contract at packages/kinds/<id>/twin/<id>.twin.json,
 *  baked from the canonical Primmel product package that references
 *  this kind. Adding a new kind's twin contract = baking the artifact
 *  into the kind package (no entry here needed — paths follow the
 *  convention). */
function kindTwinContractPath(kindId: string, kindsDir: string): string {
  // 'primmel-sst-r60' → 'sst-r60' → kinds/sst-r60/twin/r60.twin.json
  const folder = kindId.replace(/^primmel-/, '')
  const file = folder.replace(/^sst-/, '') + '.twin.json'
  return join(kindsDir, folder, 'twin', file)
}

// ── Coefficients loading ──────────────────────────────────────────────

interface NestedCoefficients {
  mechanical?: Record<string, number | string>
  transduction?: Record<string, number | string>
  conditioning?: Record<string, number | string>
  [k: string]: unknown
}

/** Flatten the nested coefficients.yaml shape (mechanical/transduction/
 *  conditioning sections) into the flat keys ComposedInstrument expects
 *  (sensitivity_mVperV, scale_interval_kg, etc.). */
function flattenCoefficients(nested: NestedCoefficients): Record<string, number> {
  const flat: Record<string, number> = {}
  for (const section of ['mechanical', 'transduction', 'conditioning'] as const) {
    const s = nested[section]
    if (!s || typeof s !== 'object') continue
    for (const [k, v] of Object.entries(s)) {
      if (typeof v === 'number') flat[k] = v
    }
  }
  // Also flatten top-level numeric values (some instance packages keep
  // a flat shape rather than nested sections).
  for (const [k, v] of Object.entries(nested)) {
    if (typeof v === 'number' && !(k in flat)) flat[k] = v
  }
  return flat
}

async function readCoefficients(pkg: LoadedPackage): Promise<Record<string, number>> {
  const coeffRel = pkg.manifest.coefficients
  if (!coeffRel) return {}
  const coeffPath = join(pkg.rootPath, coeffRel)
  const text = await readFile(coeffPath, 'utf-8')
  return flattenCoefficients(parseYaml(text) as NestedCoefficients)
}

// ── The instrument model enrichment ───────────────────────────────────
// The .prl-parsed contract carries serves + operations only. The
// Recommendation's full instrument model (identification,
// classification, designParameters, metrologicalLimits, provenance)
// lives in the instance package's package.sst.yaml. This helper
// assembles the InstrumentModel from the manifest data and returns
// the enriched contract for the schema generator.

/** Map the manifest's unit slug to a canonical BIPM Digital SI
 *  Framework URI. Per the SI-traceability memory, never an ad-hoc
 *  slug. Unknown units fall back to a literal SI unit URI (kg) and
 *  log a warning — TODO future: enforce the BIPM URI in the manifest
 *  itself. */
function bipmUriForUnit(slug: string | undefined): string {
  const SI = 'https://si-digital-framework.org/SI/units'
  switch (slug) {
    case 'kg': return `${SI}/kilogram`
    case 'g':  return `${SI}/gram`
    case 'm':  return `${SI}/metre`
    case 'degC':
    case '°C': return `${SI}/degree-celsius`
    case 'K':  return `${SI}/kelvin`
    case 'mV_per_V':
    case 'mV/V': return `${SI}/millivolt-per-volt`
    case 'percent': return `${SI}/percent`
    case 'ohm': return `${SI}/ohm`
    case 'ppm': return `${SI}/micromole-per-mole`
    default: return `${SI}/kilogram`
  }
}

function buildModelFromManifest(pkg: LoadedPackage, kindId: string): InstrumentModel {
  const m = pkg.manifest
  return {
    identification: {
      instrumentId: m.id,
      kindId,
      oimlRecommendation: m.maps_to ? `OIML ${m.maps_to.split('-').slice(0, 2).join('-').toUpperCase()}` : undefined,
      manufacturer: m.manufacturer?.name,
      model: m.title,
      designation: m.title,
      ...(m.manufacturer?.country ? { country: m.manufacturer.country } : {}),
    },
    classification: m.classification as Record<string, string | number | undefined> | undefined,
    designParameters: designParamsFromManifest(m.design_parameters),
    provenance: {
      ...(m.provenance?.certificate ? { certificate: m.provenance.certificate } : {}),
      ...(m.provenance?.first_issued ? { firstIssued: m.provenance.first_issued } : {}),
    },
  }
}

function designParamsFromManifest(
  declared: Record<string, { value: number | string; unit?: string }> | undefined,
): DesignParameters | undefined {
  if (!declared) return undefined
  const out: DesignParameters = {}
  for (const [key, entry] of Object.entries(declared)) {
    if (typeof entry.value !== 'number') continue
    const q: ModelQuantity = { value: entry.value, unit: bipmUriForUnit(entry.unit) }
    out[key] = q
  }
  return out
}

/** Enrich a parsed TwinContract with the full InstrumentModel sourced
 *  from the instance package's manifest and the kind's mpe.yaml.
 *  Returns a new contract that generateTwinSchema turns into the
 *  model-mirroring schema. */
function enrichWithModel(
  base: TwinContract,
  pkg: LoadedPackage,
  kindDirPath: string,
): TwinContract & { model: InstrumentModel } {
  const kindId = pkg.manifest.kind ?? base.instrumentId
  const model = buildModelFromManifest(pkg, kindId)
  model.metrologicalLimits = loadMetrologicalLimits(kindDirPath, pkg)
  return { ...base, model }
}

/** Load the kind's mpe.yaml and translate the relevant class's bands
 *  into the InstrumentModel.metrologicalLimits shape. The instance's
 *  classification (accuracy_class) selects which class's bands apply. */
function loadMetrologicalLimits(kindDirPath: string, pkg: LoadedPackage): MetrologicalLimits | undefined {
  const mpePath = join(kindDirPath, 'mpe.yaml')
  if (!existsSync(mpePath)) return undefined
  let parsed: unknown
  try {
    parsed = parseYaml(readFileSyncMpe(mpePath))
  } catch {
    return undefined
  }
  // vMin: derive from the instance's design parameters (E_max - E_min) / n_lc.
  const dp = pkg.manifest.design_parameters
  const eMax = typeof dp?.e_max?.value === 'number' ? dp.e_max.value : undefined
  const eMin = typeof dp?.e_min?.value === 'number' ? dp.e_min.value : undefined
  const nLc = typeof pkg.manifest.classification?.n_lc === 'number' ? pkg.manifest.classification.n_lc : undefined
  if (eMax == null || eMin == null || nLc == null) return undefined
  const vMin = (eMax - eMin) / nLc
  const config = parseMpeConfig(parsed as never, vMin)
  const className = typeof pkg.manifest.classification?.accuracy_class === 'string'
    ? pkg.manifest.classification.accuracy_class
    : 'C'
  const cls = config.classes[className] ?? config.classes['C']
  if (!cls) return undefined
  // Translate intervals-from-v_min back to kg for the wire shape; the
  // kind's mpe.yaml expresses bands as intervals of v_min.
  const limit = (parsed as { additional_limits?: { creep?: { limit?: number } } }).additional_limits?.creep?.limit
  return {
    mpeBands: cls.bands.map((b) => ({
      lower: b.intervals[0] * vMin,
      upper: Number.isFinite(b.intervals[1]) ? b.intervals[1] * vMin : Number.POSITIVE_INFINITY,
      factor: b.factor,
    })),
    ...(limit != null ? { creepAllowance: limit } : {}),
  }
}

// Synchronous file read for loadMetrologicalLimits (the YAML is small).
import { readFileSync } from 'node:fs'
function readFileSyncMpe(path: string): string {
  return readFileSync(path, 'utf-8')
}

export interface BootPaths {
  kindsDir?: string
  instancesDir?: string
}

export async function bootSession(
  instance: LoadedPackage,
  opts: SessionOptions = {},
  paths: BootPaths = {},
): Promise<Session> {
  if (instance.tier !== 'primmel-instance') {
    throw new Error(`runSession targets an instance package; got tier '${instance.tier}'`)
  }
  if (!instance.manifest.kind) {
    throw new Error(`instance package '${instance.manifest.id}' has no 'kind' reference`)
  }

  const kindId = instance.manifest.kind
  const kind = lookupKind(kindId)
  const kindsDir = paths.kindsDir ?? DEFAULT_KINDS_DIR
  // paths.instancesDir reserved for future use (instance-package
  // discovery from a non-default directory).

  // 1. Resolve the instance's classification + coefficients.
  const classification = (instance.manifest.classification ?? {}) as InstanceClassification
  const coefficients = await readCoefficients(instance)

  // 2. Load the kind's physics-chain.yaml (used by R 60's data-driven
  //    composer; harmless if absent for other kinds).
  const chainPath = join(kindDir(kindId, kindsDir), 'physics-chain.yaml')
  let physicsChain: PhysicsChainDecl | undefined
  if (existsSync(chainPath)) {
    physicsChain = loadPhysicsChain(chainPath)
  }

  // 3. Boot the instrument via the universal plug-and-play path: load
  //    the instance's behavior.js, call behavior.create(def, clock, seed),
  //    assemble the /world schema from the kind's YAML/SDL/handlers.
  //    v2 has no per-kind dispatch — every instance boots the same way.
  //    The behavior.js IS the physics; there is no fallback. Adding a
  //    new kind = authoring a kind package (data) + an instance package
  //    (behavior.js). Zero runtime edits.
  const clock = new VirtualClock()
  const seed = opts.seed ?? 42
  const kd = kindDir(kindId, kindsDir)
  const bootResult = await tryBootFromBehavior({
    instance,
    clock,
    seed,
    classification,
    coefficients,
    kindDir: kd,
    ...(physicsChain ? { physicsChain } : {}),
    ...(opts.sample ? { sample: opts.sample } : {}),
  })
  if (bootResult === null) {
    throw new Error(
      `runSession: instance '${instance.manifest.id}' has no behavior.js (looked in ${instance.rootPath}). ` +
      `v2 requires every instance package to ship a behavior.js implementing its kind's interface.d.ts.`,
    )
  }
  const { worldSchema, instrument, behavior } = bootResult

  // 4. Build the /twin schema (kind's baked contract, enriched with
  //    the full InstrumentModel sourced from the instance manifest +
  //    the kind's mpe.yaml — the digital twin mirrors the full model).
  const twinContractPath = kindTwinContractPath(kindId, kindsDir)
  if (!existsSync(twinContractPath)) {
    throw new Error(`runSession: no twin contract for kind '${kindId}' (looked for ${twinContractPath})`)
  }
  const baseContract = await loadBakedContract(twinContractPath)
  const contract = enrichWithModel(baseContract, instance, kindDir(kindId, kindsDir))

  // TwinIo: model-driven from contract serves + instrument surface +
  // optional behavior.twinRegisters. Strategy-supplied twinIo is a
  // legacy fallback only when the instrument is missing (shouldn't happen).
  const twinIo = instrument != null
    ? buildTwinIo(instrument, clock, contract, behavior)
    : bootResult.twinIo
  if (!twinIo) {
    throw new Error(`runSession: no TwinIo for kind '${kindId}'`)
  }

  const twinSchema = generateTwinSchema(contract, twinIo)
  const diffs = checkTwinConformance(twinSchema, contract)
  if (diffs.length > 0) {
    throw new Error(`twin conformance check FAILED for instance '${instance.manifest.id}':\n  - ${diffs.join('\n  - ')}`)
  }

  // 5. Boot the server with real-time twin streaming enabled.
  //    The /twin/stream endpoint emits SSE events on every clock advance,
  //    enabling continuous monitoring (not just annual calibration).
  const port = opts.port ?? kind.defaultPort
  const streamTargets = contract.serves.map(s => s.target)
  const server = await createSimServer({
    worldSchema,
    twinSchema,
    port,
    title: `${instance.manifest.title} (SST)`,
    worldToken: opts.worldToken,
    twinStream: {
      clock,
      targets: streamTargets,
      read: (target: string) => readTwinTarget(target, instrument, twinIo),
    },
  })

  return {
    port: Number(new URL(server.url).port),
    url: server.url,
    instanceId: instance.manifest.id,
    kindId,
    close: server.close,
  }
}

/** Read one twin target directly from the instrument (in-process, no HTTP).
 *  Used by the /twin/stream SSE endpoint for real-time monitoring. */
function readTwinTarget(
  target: string,
  instrument: unknown,
  twinIo: { instrument: unknown; registers?: Record<string, () => unknown> },
): unknown {
  const inst = (instrument ?? twinIo.instrument) as {
    indication?: () => unknown
    operationalState?: () => unknown
    environment?: () => unknown
  }
  if (target === 'indication' && inst.indication) return inst.indication()
  if (target === 'state' && inst.operationalState) return inst.operationalState()
  if (target === 'environmental_context' && inst.environment) return inst.environment()
  const reader = twinIo.registers?.[target]
  return reader ? reader() : null
}

export const __test__ = { flattenCoefficients, kindDir, DEFAULT_KINDS_DIR, DEFAULT_INSTANCES_DIR }
