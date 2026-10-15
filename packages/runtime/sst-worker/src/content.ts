// content.ts — assemble the runtime's SessionBundle from the
// build-injected library bundle module. The parse steps here mirror the
// FS boot's reads 1:1 (the texts ARE the files, embedded at build time
// by scripts/build.mjs from SST_LIBRARY_PATH).
//
// The physics selection: the bundle carries EVERY sample the instance
// manifest lists (the spawner's physics profiles — fresh, creep-fail,
// temp-fail, …); a session boot picks one sample's text + its bare ref.

import { parse as parseYaml } from 'yaml'
import type { PackageManifest } from '@primmel/sst-runtime/package-loader'
import type { SessionBundle, BundleHandler } from '@primmel/sst-runtime/session/boot-bundle'
import { libraryBundle } from 'sst-library-bundle'

/** The physics profiles the bundle carries (the spawner's menu) — the
 *  manifest's samples, as bare refs. */
export function libraryPhysicsProfiles(): string[] {
  return Object.keys(libraryBundle.sampleYamls).sort()
}

/** Assemble the SessionBundle for one physics profile. */
export function librarySessionBundle(select: { physics?: string } = {}): SessionBundle {
  const physics = select.physics ?? 'fresh'
  const sampleYaml = libraryBundle.sampleYamls[physics]
  if (sampleYaml == null) {
    throw new Error(
      `unknown physics profile '${physics}' — the bundle carries: ${libraryPhysicsProfiles().join(', ')}`,
    )
  }
  const manifest = parseYaml(libraryBundle.instanceManifestYaml) as PackageManifest
  return {
    instance: {
      manifest,
      coefficientsYaml: libraryBundle.coefficientsYaml,
      sampleYaml,
      sampleRef: physics,
    },
    kind: {
      worldKindSdl: libraryBundle.worldKindSdl,
      worldKindYaml: libraryBundle.worldKindYaml,
      handlers: libraryBundle.handlers as unknown as Record<string, BundleHandler>,
      twinContractJson: libraryBundle.twinContractJson,
      ...(libraryBundle.mpeYaml != null ? { mpeYaml: libraryBundle.mpeYaml } : {}),
      ...(libraryBundle.physicsChainYaml != null
        ? { physicsChainYaml: libraryBundle.physicsChainYaml }
        : {}),
    },
    behaviorModule: libraryBundle.behavior,
  }
}
