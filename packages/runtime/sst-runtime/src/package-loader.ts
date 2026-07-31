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

  // Migration stubs
  status?: 'stub' | 'production'
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

async function getValidator() {
  if (_validator) return _validator
  if (!_ajv) {
    const { default: Ajv2020 } = await import('ajv/dist/2020.js')
    const { default: addFormats } = await import('ajv-formats')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Ctor = (Ajv2020 as any)
    _ajv = new Ctor({ allErrors: true, strict: false }) as AjvInstance
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(addFormats as any)(_ajv as any)
  }
  const schemaPath = resolve(import.meta.dirname ?? '.', '..', '..', '..', 'specs', 'schemas', 'package-manifest.schema.json')
  const schemaText = await readFile(schemaPath, 'utf-8').catch(() => null)
  if (!schemaText) return null
  const schema = JSON.parse(schemaText)
  _validator = _ajv!.compile(schema)
  return _validator
}

export async function validateManifest(manifest: PackageManifest): Promise<void> {
  const validate = await getValidator()
  if (!validate) return
  const ok = validate(manifest)
  if (!ok) {
    const errs = _ajv!.errors ?? []
    const errors = errs.map((e) => `${e.instancePath || '(root)'}: ${e.message ?? 'invalid'}`)
    throw new Error(`manifest validation failed for '${manifest.id ?? '<no-id>'}':\n  - ${errors.join('\n  - ')}`)
  }
}
