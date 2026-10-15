// assemble-bundle.ts — assemble the runtime's SessionBundle from a
// declared instrument library checkout (node-side: this module touches
// the filesystem and dynamic-imports the library's behavior + handlers,
// so it is used by the BUILD script and the TESTS — never by the worker
// entry, whose bundle content arrives via the build-injected virtual
// module).
//
// The file resolution here is the FS loader's doctrine, mirrored:
//   - the sample: prefer the sample named `fresh`, else the first
//     listed (loadDefaultSample); an explicit ref wins (loadSample's
//     exact-then-partial match).
//   - the kind tree: manifest.kind 'primmel-sst-r60' →
//     packages/kinds/sst-r60, the contract at twin/r60.twin.json.

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parse as parseYaml } from 'yaml'
import type { PackageManifest } from '@primmel/sst-runtime/package-loader'
import type { SessionBundle, BundleHandler } from '@primmel/sst-runtime/session/boot-bundle'

export interface AssembleOptions {
  instance?: string
  sample?: string
}

/** Assemble a SessionBundle from a library checkout. */
export async function assembleLibraryBundle(
  libraryPath: string,
  opts: AssembleOptions = {},
): Promise<SessionBundle> {
  const instanceId = opts.instance ?? 'acme-lc500'
  const instanceDir = join(libraryPath, 'packages', 'instances', instanceId)
  const manifest = parseYaml(await readFile(join(instanceDir, 'package.sst.yaml'), 'utf-8')) as PackageManifest
  if (!manifest.kind) {
    throw new Error(`assembleLibraryBundle: instance '${instanceId}' has no 'kind' reference`)
  }
  const kindFolder = manifest.kind.replace(/^primmel-/, '')
  const kindDir = join(libraryPath, 'packages', 'kinds', kindFolder)

  const coefficientsYaml = await readFile(join(instanceDir, manifest.coefficients ?? 'coefficients.yaml'), 'utf-8')

  const sampleRef = opts.sample ?? defaultSampleRef(manifest.samples)
  const sampleYaml = sampleRef
    ? await readFile(join(instanceDir, resolveSamplePath(manifest.samples, sampleRef)), 'utf-8')
    : undefined

  const worldKindSdl = await readFile(join(kindDir, 'world-kind.sdl.graphql'), 'utf-8')
  const worldKindYaml = await readFile(join(kindDir, 'world-kind.yaml'), 'utf-8')
  const readOptional = async (rel: string): Promise<string | undefined> =>
    readFile(join(kindDir, rel), 'utf-8').catch(() => undefined)
  const mpeYaml = await readOptional('mpe.yaml')
  const physicsChainYaml = await readOptional('physics-chain.yaml')
  const contractFile = `${kindFolder.replace(/^sst-/, '')}.twin.json`
  const twinContractJson: unknown = JSON.parse(await readFile(join(kindDir, 'twin', contractFile), 'utf-8'))

  const behaviorModule: unknown = await import(pathToFileURL(join(instanceDir, manifest.behavior ?? 'behavior.js')).href)
  const handlersModule = await import(pathToFileURL(join(kindDir, 'handlers.ts')).href) as {
    handlers: Record<string, BundleHandler>
  }

  return {
    instance: {
      manifest,
      coefficientsYaml,
      ...(sampleYaml != null ? { sampleYaml } : {}),
      ...(sampleRef != null ? { sampleRef } : {}),
    },
    kind: {
      worldKindSdl,
      worldKindYaml,
      handlers: handlersModule.handlers,
      twinContractJson,
      ...(mpeYaml != null ? { mpeYaml } : {}),
      ...(physicsChainYaml != null ? { physicsChainYaml } : {}),
    },
    behaviorModule,
  }
}

/** The default sample ref (the FS loader's loadDefaultSample doctrine:
 *  prefer the sample named `fresh`, else the first listed), as a bare
 *  name ('fresh', 'aged-2024', …). */
export function defaultSampleRef(samples?: string[]): string | undefined {
  if (!samples?.length) return undefined
  const fresh = samples.find((s) => s.includes('fresh'))
  return bareSampleRef(fresh ?? samples[0]!)
}

/** Map a sample ref to its manifest path (the FS loader's exact-then-
 *  partial match). */
export function resolveSamplePath(samples: string[] | undefined, ref: string): string {
  if (samples) {
    const exact = samples.filter(
      (s) => s === ref
        || s === `${ref}.yaml`
        || s === `samples/${ref}.yaml`
        || s.replace(/\.yaml$/, '').split('/').pop() === ref,
    )
    const matches = exact.length > 0 ? exact : samples.filter((s) => s.includes(ref))
    if (matches.length > 0) return matches[0]!
  }
  return `samples/${ref}.yaml`
}

function bareSampleRef(listed: string): string {
  return listed.replace(/^samples\//, '').replace(/\.yaml$/, '')
}
