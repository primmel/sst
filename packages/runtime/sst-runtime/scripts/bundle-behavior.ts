// bundle-behavior.ts — bundles an instance package's src/behavior.ts
// into a self-contained behavior.js using esbuild.
//
// Usage: npx tsx scripts/bundle-behavior.ts <instance-root>
//
// The output is written to <instance-root>/behavior.js — the artifact
// the runtime's loadBehavior() imports at boot time. The bundle
// inlines all imports (no node_modules resolution needed at runtime).

import { build, type BuildOptions } from 'esbuild'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const instanceRoot = process.argv[2]
if (!instanceRoot) {
  console.error('Usage: bundle-behavior.ts <instance-root>')
  process.exit(1)
}

const entryPoint = join(instanceRoot, 'src', 'behavior.ts')
const outPath = join(instanceRoot, 'behavior.js')

const options: BuildOptions = {
  entryPoints: [entryPoint],
  outfile: outPath,
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  sourcemap: false,
  legalComments: 'none',
  logLevel: 'info',
  // The runtime is always present at boot time — mark it external.
  // The bundled behavior.js uses `import ... from '@primmel/sst-runtime'`
  // which the runtime's own module system resolves.
  external: ['@primmel/sst-runtime', '@primmel/sst-runtime/*'],
}

await build(options)
console.log(`✓ bundled ${outPath}`)

// Verify the bundle loads.
const mod = await import(`file://${resolve(outPath)}`)
if (typeof mod.create !== 'function' && typeof mod.default?.create !== 'function') {
  console.error(`✗ bundle at ${outPath} has no create() export`)
  process.exit(1)
}
console.log(`✓ verified: create() present`)
