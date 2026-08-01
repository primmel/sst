#!/usr/bin/env tsx
// primmel-sst — the SST CLI. Boots sessions, validates packages,
// lists kinds/instances.

import { parseArgs } from 'node:util'
import { loadPackage } from './package-loader.js'
import { listKinds } from './kinds/registry.js'
import { runSession } from './session.js'

const { positionals } = parseArgs({
  allowPositionals: true,
  options: {
    port:       { type: 'string' },
    sample:     { type: 'string' },
    seed:       { type: 'string', default: '42' },
  },
})

const command = positionals[0] ?? 'help'
const target = positionals[1]

switch (command) {
  case 'help':
  case '--help':
  case '-h':
    printHelp()
    break

  case 'validate': {
    if (!target) { console.error('validate requires a package path'); process.exit(2) }
    try {
      const pkg = await loadPackage(target)
      const m = pkg.manifest
      console.log(`✓ ${m.id} (${pkg.tier})` + (m.composition
        ? ` — composite: ${Object.keys(m.composition.components).length} components, ${Object.keys(m.composition.decomposition).length} registers`
        : ''))
      console.log(`  title: ${m.title}`)
      if (m.kind)              console.log(`  kind: ${m.kind}`)
      if (m.base)              console.log(`  base: ${m.base}`)
      if (m.active_domain)     console.log(`  active domain: ${m.active_domain}`)
      if (m.composition) {
        const c = m.composition
        console.log(`  components: ${Object.keys(c.components).join(', ')}`)
        console.log(`  state rule: ${c.state_rule}`)
        if (c.couplings?.length) console.log(`  couplings: ${c.couplings.length}`)
      }
    } catch (err) {
      console.error(`✗ ${(err as Error).message}`)
      process.exit(1)
    }
    break
  }

  case 'list-kinds': {
    const kinds = listKinds()
    if (kinds.length === 0) { console.log('(no kinds registered)'); break }
    for (const k of kinds) {
      console.log(`${k.kindId}\t${k.activeDomain}\tport ${k.defaultPort}`)
    }
    break
  }

  case 'run': {
    if (!target) { console.error('run requires an instance package path'); process.exit(2) }
    try {
      const pkg = await loadPackage(target)
      if (pkg.tier !== 'primmel-instance') {
        console.error(`'run' targets an instance package; got ${pkg.tier}`)
        process.exit(2)
      }
      await runSession(pkg, {
        port: positionals[2] ? Number(positionals[2]) : undefined,
        sample: positionals[3],
      })
    } catch (err) {
      console.error(`✗ ${(err as Error).message}`)
      process.exit(1)
    }
    break
  }

  default:
    console.error(`unknown command: ${command}`)
    printHelp()
    process.exit(2)
}

function printHelp(): void {
  console.log(`primmel-sst — the Simulated SMART Twin CLI

USAGE
  primmel-sst <command> [args] [options]

COMMANDS
  validate <package-path>           load + validate a package manifest
  list-kinds                        list registered instrument kinds
  run <instance-path> [port] [sample]
                                    boot a running session

OPTIONS
  --port <n>      override the kind's default port
  --sample <name> choose a sample variant
  --seed <n>      RNG seed (default: 42)
`)
}
