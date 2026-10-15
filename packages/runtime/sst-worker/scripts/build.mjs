// build.mjs — bundle the worker artifact: the runtime + the worker
// adapter + the DECLARED instrument library's instance package (files
// as bundled texts/imports — the FS loader's reads, replaced by the
// bundle). SST_LIBRARY_PATH is required: the content always comes from
// a declared library checkout, never from the framework repo (the
// boundary rule).
//
//   SST_LIBRARY_PATH=~/src/oimlsmart/sst npm run build

import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { build } from 'esbuild'

const INSTANCE_ID = 'acme-lc500'
const KIND_FOLDER = 'sst-r60'

const libraryPath = process.env.SST_LIBRARY_PATH
if (!libraryPath) {
  console.error('build requires SST_LIBRARY_PATH — the instrument library checkout (a tree with packages/kinds + packages/instances)')
  process.exit(2)
}
const libRoot = resolve(libraryPath)
const instanceDir = join(libRoot, 'packages', 'instances', INSTANCE_ID)
const kindDir = join(libRoot, 'packages', 'kinds', KIND_FOLDER)
const manifest = parseYaml(await readFile(join(instanceDir, 'package.sst.yaml'), 'utf-8'))
const samples = manifest.samples ?? []
const fresh = samples.find((s) => s.includes('fresh')) ?? samples[0]
if (!fresh) {
  console.error(`instance '${INSTANCE_ID}' declares no samples — nothing to bundle`)
  process.exit(2)
}
const sampleRef = fresh.replace(/^samples\//, '').replace(/\.yaml$/, '')

const p = (s) => JSON.stringify(s)

// The virtual module: the library content, as imports (the texts ride
// esbuild's text/json loaders below; the behavior + handlers are real
// modules that join the bundle).
const virtualModule = /* js */ `
import * as behavior from ${p(join(instanceDir, manifest.behavior ?? 'behavior.js'))};
import { handlers } from ${p(join(kindDir, 'handlers.ts'))};
import instanceManifestYaml from ${p(join(instanceDir, 'package.sst.yaml'))};
import coefficientsYaml from ${p(join(instanceDir, manifest.coefficients ?? 'coefficients.yaml'))};
import sampleYaml from ${p(join(instanceDir, fresh))};
import worldKindSdl from ${p(join(kindDir, 'world-kind.sdl.graphql'))};
import worldKindYaml from ${p(join(kindDir, 'world-kind.yaml'))};
import mpeYaml from ${p(join(kindDir, 'mpe.yaml'))};
import physicsChainYaml from ${p(join(kindDir, 'physics-chain.yaml'))};
import twinContractJson from ${p(join(kindDir, 'twin', `${KIND_FOLDER.replace(/^sst-/, '')}.twin.json`))};

export const libraryBundle = {
  instanceManifestYaml,
  coefficientsYaml,
  sampleYaml,
  sampleRef: ${p(sampleRef)},
  worldKindSdl,
  worldKindYaml,
  handlers,
  twinContractJson,
  mpeYaml,
  physicsChainYaml,
  behavior,
};
`

const sstLibraryBundlePlugin = {
  name: 'sst-library-bundle',
  setup(b) {
    b.onResolve({ filter: /^sst-library-bundle$/ }, () => ({
      path: 'sst-library-bundle',
      namespace: 'sst-bundle',
    }))
    b.onLoad({ filter: /.*/, namespace: 'sst-bundle' }, () => ({
      resolveDir: libRoot,
      loader: 'ts',
      contents: virtualModule,
    }))
    // The library's YAML/SDL data files ride as text (never parsed by
    // the bundler; the runtime parses them at boot exactly like the FS
    // loader does). Scoped to the declared library root.
    b.onLoad({ filter: /\/packages\/(?:instances|kinds)\/.+\.(?:yaml|yml|graphql)$/ }, async (args) => {
      if (!args.path.startsWith(libRoot)) return undefined
      return { contents: await readFile(args.path, 'utf-8'), loader: 'text' }
    })
  },
}

const result = await build({
  entryPoints: [new URL('../src/index.ts', import.meta.url).pathname],
  bundle: true,
  platform: 'neutral',
  format: 'esm',
  target: 'es2022',
  // The fetch-API layers (graphql-yoga → @whatwg-node/*) resolve their
  // workerd/browser builds; workerd provides the fetch globals natively.
  mainFields: ['workerd', 'browser', 'module', 'main'],
  conditions: ['workerd', 'worker', 'browser', 'module'],
  outfile: new URL('../dist/worker.js', import.meta.url).pathname,
  sourcemap: true,
  legalComments: 'none',
  external: ['node:*'],
  // The behavior bundles' createRequire banner imports 'module' (bare).
  // The shim routes `require('process')` to the workerd global (the
  // module registry lacks node:process while the global exists) and
  // delegates everything else to the native createRequire. Only the
  // bare specifier is aliased — the shim's own 'node:module' import
  // must stay native.
  alias: {
    module: new URL('./stubs/node-module-shim.js', import.meta.url).pathname,
  },
  // workerd leaves `import.meta.url` undefined in bundled workers; the
  // runtime's module-level path math (session/boot.ts, library-paths.ts)
  // only needs A valid file URL to compute constants it never uses on
  // the bundle path — and the behavior bundle's createRequire needs a
  // URL-shaped base too.
  define: { 'import.meta.url': '"file:///sst-worker/worker.js"' },
  plugins: [sstLibraryBundlePlugin],
  logLevel: 'info',
})

const warnings = (result?.warnings ?? []).filter((w) => !/node:/i.test(w.text ?? ''))
if (warnings.length > 0) {
  console.error('build warnings:')
  for (const w of warnings) console.error('  -', w.text)
}
console.log(`bundled ${INSTANCE_ID} (${sampleRef}) from ${libRoot} → dist/worker.js`)
