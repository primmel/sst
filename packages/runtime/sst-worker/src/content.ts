// content.ts — assemble the runtime's SessionBundle from the
// build-injected library bundle module. The parse steps here mirror the
// FS boot's reads 1:1 (the texts ARE the files, embedded at build time
// by scripts/build.mjs from SST_LIBRARY_PATH).

import { parse as parseYaml } from 'yaml'
import type { PackageManifest } from '@primmel/sst-runtime/package-loader'
import type { SessionBundle } from '@primmel/sst-runtime/session/boot-bundle'
import type { BundleHandler } from '@primmel/sst-runtime/session/boot-bundle'
import { libraryBundle } from 'sst-library-bundle'

export function librarySessionBundle(): SessionBundle {
  const manifest = parseYaml(libraryBundle.instanceManifestYaml) as PackageManifest
  return {
    instance: {
      manifest,
      coefficientsYaml: libraryBundle.coefficientsYaml,
      ...(libraryBundle.sampleYaml != null ? { sampleYaml: libraryBundle.sampleYaml } : {}),
      ...(libraryBundle.sampleRef != null ? { sampleRef: libraryBundle.sampleRef } : {}),
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
