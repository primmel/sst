// kinds/definition-builder.ts — build the definition object that
// behavior.create(def, clock, seed) receives.
//
// The definition is assembled from the instance package's data:
//   - package.sst.yaml classification + design_parameters
//   - coefficients.yaml (flattened)
//   - optional sample overrides (samples/<name>.yaml)
//   - optional physics-chain (for data-driven composers)
//
// Keys are provided in BOTH snake_case and camelCase so instance
// behaviors can consume either convention without translation glue.

import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { parse as parseYaml } from 'yaml'
import type { LoadedPackage } from '../package-loader.js'
import type { PhysicsChainDecl } from '../stages/data-driven.js'
import { snakeToCamel } from '../twin-schema.js'

export interface DefinitionBuildInput {
  instance: LoadedPackage
  coefficients: Record<string, number>
  classification: Record<string, string | undefined>
  physicsChain?: PhysicsChainDecl
  sample?: string
}

/** Build the definition object for behavior.create(). */
export async function buildInstanceDefinition(input: DefinitionBuildInput): Promise<Record<string, unknown>> {
  const { instance, coefficients, classification, physicsChain, sample } = input
  const m = instance.manifest

  const sampleData = sample
    ? await loadSample(instance.rootPath, sample, m.samples)
    : await loadDefaultSample(instance.rootPath, m.samples)

  const designParams = designParametersFromManifest(m.design_parameters)
  const classif = withCamelAliases(classification as Record<string, unknown>)

  // Merge sample coefficient overrides (snake + camel).
  const coeffOverrides = flattenSampleOverrides(sampleData?.overrides)
  const mergedCoefficients = { ...coefficients, ...coeffOverrides }

  const stack =
    (classification.stack as string | undefined) ??
    'digital'

  return {
    id: m.id,
    classification: classif,
    designParameters: designParams,
    stack,
    coefficients: withCamelAliases(mergedCoefficients),
    fidelity: sampleData?.fidelity ?? {},
    sample: sampleData?.sample_name ?? sample ?? 'fresh',
    ...(physicsChain ? { physicsChain } : {}),
  }
}

interface SampleData {
  sample_name?: string
  kind_scenario?: string
  overrides?: Record<string, unknown>
  fidelity?: Record<string, unknown>
}

async function loadDefaultSample(
  root: string,
  samples?: string[],
): Promise<SampleData | undefined> {
  if (!samples?.length) return undefined
  // Prefer a sample named fresh; otherwise the first listed.
  const fresh = samples.find((s) => s.includes('fresh'))
  return loadSample(root, fresh ?? samples[0]!, samples)
}

async function loadSample(
  root: string,
  sampleRef: string,
  samples?: string[],
): Promise<SampleData | undefined> {
  // sampleRef may be a bare name ("fresh") or a path ("samples/fresh.yaml").
  const candidates = [
    join(root, sampleRef),
    join(root, `${sampleRef}.yaml`),
    join(root, 'samples', sampleRef),
    join(root, 'samples', `${sampleRef}.yaml`),
  ]
  // Also try matching against the samples list.
  if (samples) {
    for (const s of samples) {
      if (s.includes(sampleRef)) candidates.unshift(join(root, s))
    }
  }
  for (const p of candidates) {
    if (!existsSync(p)) continue
    const text = await readFile(p, 'utf-8')
    return parseYaml(text) as SampleData
  }
  return undefined
}

function designParametersFromManifest(
  declared: Record<string, { value: number | string; unit?: string }> | undefined,
): Record<string, unknown> {
  if (!declared) return {}
  const out: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(declared)) {
    if (typeof entry?.value !== 'number') continue
    out[key] = entry.value
    out[snakeToCamel(key)] = entry.value
    // Common aliases used by kind interfaces (eMaxKg, etc.).
    if (key === 'e_max') out.eMaxKg = entry.value
    if (key === 'e_min') out.eMinKg = entry.value
    if (key === 'v_min') out.vMinKg = entry.value
    if (key === 'dr' || key === 'd_r') out.drKg = entry.value
    if (key === 't_min') out.tMinDegC = entry.value
    if (key === 't_max') out.tMaxDegC = entry.value
    if (key === 'n_lc') out.nLc = entry.value
  }
  return out
}

function flattenSampleOverrides(overrides: Record<string, unknown> | undefined): Record<string, number> {
  if (!overrides) return {}
  const out: Record<string, number> = {}
  for (const [k, v] of Object.entries(overrides)) {
    if (typeof v === 'number') {
      out[k] = v
      out[toSnake(snakeToCamel(k))] = v // ensure snake form
    }
  }
  return out
}

/** Add camelCase aliases alongside existing keys. */
function withCamelAliases(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...obj }
  for (const [k, v] of Object.entries(obj)) {
    const camel = snakeToCamel(k)
    if (!(camel in out)) out[camel] = v
    // Also classification-style: accuracy_class → accuracyClass already via snakeToCamel.
  }
  return out
}

function toSnake(camel: string): string {
  return camel.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)
}
