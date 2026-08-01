// bundle-behavior.ts — bundles an instance package's src/behavior.ts
// into a self-contained behavior.js using esbuild.
//
// Usage: npx tsx scripts/bundle-behavior.ts <instance-root>
//
// The output is written to <instance-root>/behavior.js — the artifact
// the runtime's loadBehavior() imports at boot time. The bundle inlines
// ALL imports — including @primmel/sst-runtime — so the behavior.js is
// self-contained: it loads from a monorepo checkout, an uploaded ZIP
// extracted to /tmp, or any future deployment, with zero node_modules
// resolution. The runtime's physics library becomes part of the
// instance's bundled artifact (the price of true plug-and-play).

import { build, type BuildOptions } from 'esbuild'
import { resolve, join } from 'node:path'

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
  // Node builtins stay external (esbuild handles this automatically for
  // platform: 'node', but explicitly listing them documents the contract).
  // Everything else — including @primmel/sst-runtime — is bundled inline
  // so the behavior.js is self-contained: it loads from a monorepo
  // checkout, an uploaded ZIP extracted to /tmp, or any future
  // deployment, with zero node_modules resolution. The runtime's
  // physics library becomes part of the instance's bundled artifact
  // (the price of true plug-and-play).
  external: [],
  banner: {
    js: `import { createRequire as _cr } from 'module'; const require = _cr(import.meta.url);`,
  },
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
