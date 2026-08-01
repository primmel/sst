// package-loader.ts — ZIP/directory → LoadedPackage.
//
// The runtime's entry to package data. Detects ZIP vs directory (for
// ZIP: extract to a temp dir), reads package.sst.yaml, validates
// against specs/schemas/package-manifest.schema.json, and returns a
// typed LoadedPackage.

import { readFile, stat, mkdir, writeFile, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, resolve, dirname, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { randomBytes } from 'node:crypto'
import { parse } from 'yaml'
import { open as openZip, type Entry, type ZipFile } from 'yauzl'

// AJV is loaded dynamically to avoid ESM/CJS interop type issues.
// The schema lives in specs/schemas/package-manifest.schema.json.

const MANIFEST_FILE = 'package.sst.yaml' as const

export type Tier = 'oiml-base' | 'oiml-kind' | 'primmel-instance'

export interface PackageManifest {
  sst_version: string
  tier: Tier
  id: string
  title: string
  description?: string
  maps_to?: string

  // tier: oiml-base
  condition_classes?: Record<string, string[]>

  // tier: oiml-kind
  base?: string
  active_domain?: string
  oiml_recommendation?: { id: string; edition?: string; parts?: string[] }

  // tier: primmel-instance
  kind?: string
  version?: string
  manufacturer?: { id: string; name: string; country?: string; contact?: string }
  classification?: Record<string, unknown>
  design_parameters?: Record<string, { value: number | string; unit?: string }>
  model?: string
  coefficients?: string
  behavior?: string
  samples?: string[]
  provenance?: { certificate?: string; first_issued?: string }

  // tier: primmel-instance — the composite overlay (spec 13)
  composition?: CompositionDeclaration

  // Migration stubs
  status?: 'stub' | 'production'
}

/** A composite composition declaration (specs/13 §1). Replaces `kind`
 *  for instance packages that boot as a system of components. */
export interface CompositionDeclaration {
  source_of_truth?: string
  components: Record<string, { instance: string }>
  decomposition: Record<string, string>
  state_rule: string
  state_rule_args?: Record<string, unknown>
  couplings?: Array<{ from: string; to: string }>
}

export interface LoadedPackage {
  manifest: PackageManifest
  tier: Tier
  rootPath: string
  /** For ZIP-loaded packages: removes the temp extraction directory.
   *  No-op for directory-loaded packages. Call when the session ends. */
  cleanup?: (() => Promise<void>) | undefined
}

/**
 * Load a package from a directory or ZIP file.
 *
 * For ZIPs: extracts to a temp directory under os.tmpdir(), validates,
 * and returns a LoadedPackage whose `cleanup` removes the temp dir.
 * The caller is responsible for invoking `cleanup` when done (the
 * session's close() does this).
 *
 * Throws on invalid manifests, missing files, or schema violations.
 */
export async function loadPackage(source: string): Promise<LoadedPackage> {
  const { rootPath, isTemp } = await resolveToRoot(source)
  const manifest = await readManifest(rootPath)
  await validateManifest(manifest)
  return {
    manifest,
    tier: manifest.tier,
    rootPath,
    cleanup: isTemp ? () => rm(rootPath, { recursive: true, force: true }) : undefined,
  }
}

async function resolveToRoot(source: string): Promise<{ rootPath: string; isTemp: boolean }> {
  const abs = resolve(source)
  const stats = await stat(abs).catch(() => null)
  if (!stats) {
    throw new Error(`package source not found: ${abs}`)
  }
  if (stats.isFile() && abs.endsWith('.zip')) {
    const dest = await makeTempDir()
    await extractZip(abs, dest)
    return { rootPath: dest, isTemp: true }
  }
  if (!stats.isDirectory()) {
    throw new Error(`package source is neither a directory nor a .zip: ${abs}`)
  }
  return { rootPath: abs, isTemp: false }
}

async function makeTempDir(): Promise<string> {
  const name = `primmel-sst-${randomBytes(8).toString('hex')}`
  const path = join(tmpdir(), name)
  await mkdir(path, { recursive: true })
  return path
}

/** Extract a ZIP file to a destination directory. Each entry is written
 *  relative to the destination; path traversal attempts (entries with
 *  leading `..` or absolute paths) are rejected. */
export async function extractZip(zipPath: string, destDir: string): Promise<void> {
  const zip: ZipFile = await new Promise((resolveP, rejectP) => {
    openZip(zipPath, { lazyEntries: true, autoClose: true }, (err, zf) => err ? rejectP(err) : resolveP(zf))
  })
  await new Promise<void>((resolveP, rejectP) => {
    zip.on('entry', (entry: Entry) => {
      handleEntry(zip, entry, destDir).then(() => zip.readEntry()).catch(rejectP)
    })
    zip.on('end', resolveP)
    zip.on('error', rejectP)
    zip.readEntry()
  })
}

async function handleEntry(zip: ZipFile, entry: Entry, destDir: string): Promise<void> {
  const safePath = sanitizeEntryPath(entry.fileName, destDir)
  if (entry.fileName.endsWith('/')) {
    await mkdir(safePath, { recursive: true })
    return
  }
  await mkdir(dirname(safePath), { recursive: true })
  const stream = await new Promise<NodeJS.ReadableStream>((resolveP, rejectP) => {
    zip.openReadStream(entry, (err, s) => err ? rejectP(err) : resolveP(s))
  })
  const chunks: Buffer[] = []
  for await (const chunk of stream as NodeJS.ReadableStream) {
    chunks.push(chunk as Buffer)
  }
  await writeFile(safePath, Buffer.concat(chunks))
}

function sanitizeEntryPath(entryName: string, destDir: string): string {
  // Normalise to forward slashes, strip any leading slashes, reject `..`.
  const normalised = entryName.split('/').filter(Boolean).join(sep)
  if (!normalised || normalised.startsWith('..') || normalised.includes(`..${sep}`)) {
    throw new Error(`ZIP entry escapes destination directory: ${entryName}`)
  }
  return join(destDir, normalised)
}

async function readManifest(rootPath: string): Promise<PackageManifest> {
  const manifestPath = join(rootPath, MANIFEST_FILE)
  const text = await readFile(manifestPath, 'utf-8').catch(() => {
    throw new Error(`no ${MANIFEST_FILE} at package root: ${rootPath}`)
  })
  const parsed = parse(text) as PackageManifest
  if (!parsed || typeof parsed !== 'object') {
    throw new Error(`manifest did not parse to an object: ${manifestPath}`)
  }
  return parsed
}

/**
 * Validate a manifest against specs/schemas/package-manifest.schema.json.
 * Uses the AJV-compiled schema — the manifest JSON Schema is the SSOT.
 * Throws with precise error paths + messages on failure. */
interface AjvInstance {
  compile: (schema: unknown) => (data: unknown) => boolean
  errors: Array<{ instancePath: string; message?: string }> | null
}

let _ajv: AjvInstance | undefined
let _validator: ((data: unknown) => boolean) | undefined
let _compositeValidator: ((data: unknown) => boolean) | undefined

// The schemas directory, resolved at module load via fileURLToPath
// (import.meta.dirname has tsx-specific quirks inside async function
// bodies; fileURLToPath(import.meta.url) is stable everywhere).
import { fileURLToPath as _fileURLToPath } from 'node:url'
const SCHEMAS_DIR = resolve(dirname(_fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'specs', 'schemas')

async function loadAjv(): Promise<void> {
  if (_ajv) return
  const { default: Ajv2020 } = await import('ajv/dist/2020.js')
  const { default: addFormats } = await import('ajv-formats')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Ctor = (Ajv2020 as any)
  _ajv = new Ctor({ allErrors: true, strict: false }) as AjvInstance
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(addFormats as any)(_ajv as any)
  const mainText = await readFile(join(SCHEMAS_DIR, 'package-manifest.schema.json'), 'utf-8').catch(() => null)
  if (mainText) _validator = _ajv!.compile(JSON.parse(mainText))
  const compositeText = await readFile(join(SCHEMAS_DIR, 'composite-package.schema.json'), 'utf-8').catch(() => null)
  if (compositeText) _compositeValidator = _ajv!.compile(JSON.parse(compositeText))
}

export async function validateManifest(manifest: PackageManifest): Promise<void> {
  await loadAjv()
  if (_validator) {
    const ok = _validator(manifest)
    if (!ok) {
      const errs = (_validator as { errors?: Array<{ instancePath: string; message?: string }> }).errors ?? _ajv!.errors ?? []
      const errors = errs.map((e) => `${e.instancePath || '(root)'}: ${e.message ?? 'invalid'}`)
      throw new Error(`manifest validation failed for '${manifest.id ?? '<no-id>'}':\n  - ${errors.join('\n  - ')}`)
    }
  }
  // Composite overlay: when the manifest carries `composition`, run the
  // composite schema on top + the semantic checks the schema can't express
  // (decomposition totality, state-rule registry membership, component
  // path resolvability).
  if (manifest.composition) {
    if (!_compositeValidator) {
      throw new Error(`composite manifest validation cannot proceed: composite-package.schema.json did not load`)
    }
    const ok = _compositeValidator(manifest)
    if (!ok) {
      const errs = (_compositeValidator as { errors?: Array<{ instancePath: string; message?: string }> }).errors ?? _ajv!.errors ?? []
      const errors = errs.map((e) => `${e.instancePath || '(root)'}: ${e.message ?? 'invalid'}`)
      throw new Error(`composite manifest validation failed for '${manifest.id ?? '<no-id>'}':\n  - ${errors.join('\n  - ')}`)
    }
    validateCompositionSemantics(manifest)
  }
}

/** Cross-field checks the JSON schema can't express. The package source
 *  path is unknown to the schema, so resolvability + totality are checked
 *  here. State-rule registry membership is checked in the runtime boot. */
function validateCompositionSemantics(manifest: PackageManifest): void {
  const c = manifest.composition
  if (!c) return
  // Decomposition totality: every composite register sourced exactly once.
  const seen = new Map<string, number>()
  for (const target of Object.keys(c.decomposition)) {
    const source = c.decomposition[target]!
    if (seen.has(source)) {
      throw new Error(
        `composite '${manifest.id}': decomposition source '${source}' is mapped to multiple composite registers ` +
        `(${seen.get(source)} and ${target}) — each source may feed exactly one composite register`,
      )
    }
    seen.set(source, target)
  }
  // Each decomposition value must be component.register.
  for (const [target, source] of Object.entries(c.decomposition)) {
    const parts = source.split('.')
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      throw new Error(
        `composite '${manifest.id}': decomposition '${target}: ${source}' must be 'component.register'`,
      )
    }
    if (!(parts[0]! in c.components) && parts[0] !== '<computed>') {
      throw new Error(
        `composite '${manifest.id}': decomposition '${target}' references unknown component '${parts[0]}' ` +
        `(known components: ${Object.keys(c.components).join(', ')})`,
      )
    }
  }
  // Couplings reference existing components.
  for (const coupling of c.couplings ?? []) {
    for (const port of [coupling.from, coupling.to] as const) {
      const [componentId] = port.split('.')
      if (componentId && !(componentId in c.components)) {
        throw new Error(
          `composite '${manifest.id}': coupling ${port} references unknown component '${componentId}' ` +
          `(known components: ${Object.keys(c.components).join(', ')})`,
        )
      }
    }
  }
}

// (debug code removed)
