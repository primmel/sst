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
  // graphql + graphql-yoga are peer deps — every behavior.js loads inside
  // the runtime's module graph where they're already installed. Bundling
  // them inline creates duplicate instances ("Cannot use GraphQLSchema
  // from another realm" — graphql-yoga's instanceof check fails across
  // realms). Marking them external lets the bundle resolve them from the
  // host's node_modules at runtime, sharing the single instance.
  // All OTHER @primmel/sst-runtime code is bundled inline — the behavior.js
  // is otherwise self-contained.
  external: ['graphql', 'graphql-yoga', '@graphql-tools/utils', '@graphql-tools/executor', '@whatwg-node/fetch', '@whatwg-node/server', '@whatwg-node/promise-helpers'],
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
