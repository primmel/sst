#!/usr/bin/env tsx
// primmel-sst — the SST CLI. Boots sessions, validates packages,
// lists kinds/instances. The console mode (--console) drives a
// readline loop against a single instance (load-cell-shaped grammar;
// see console/grammar.ts).

import { parseArgs } from 'node:util'
import { loadPackage } from './package-loader.js'
import { listKinds } from './kinds/registry.js'
import { runSession } from './session.js'
import { httpConsoleIo } from './console/client.js'
import { runConsole } from './console/readline.js'

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    port:       { type: 'string' },
    sample:     { type: 'string' },
    seed:       { type: 'string', default: '42' },
    console:    { type: 'boolean', default: false },
  },
})
const consoleMode = values.console ?? false

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
      const port = positionals[2] ? Number(positionals[2]) : undefined
      const session = await runSession(pkg, {
        port,
        sample: positionals[3],
      })
      // --console: drive a readline loop against the booted session.
      // The grammar is load-cell-shaped (place load, remove load, …);
      // other kinds drive via /world directly. See CLAUDE.md.
      if (consoleMode) {
        const io = httpConsoleIo(session.url, (t) => process.stdout.write(t))
        const rl = runConsole(io, process.stdin, process.stdout)
        // Wait for readline to close (EOF) AND any queued commands to
        // complete before closing the session + exiting.
        rl.on('close', () => {
          // Allow the chain to drain — piped scripts must complete.
          setImmediate(async () => {
            await new Promise((r) => setTimeout(r, 500))
            await session.close()
            process.exit(0)
          })
        })
      } else {
        // Run until SIGTERM/SIGINT.
        process.on('SIGTERM', () => session.close().then(() => process.exit(0)))
        process.on('SIGINT', () => session.close().then(() => process.exit(0)))
      }
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
