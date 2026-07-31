// twin-contract-prl.ts — the build-time adapter: parse a Primmel
// product package into a TwinContract (spec §6/§9). This module is
// the ONLY primmel-ts consumer in the runtime tree — standalone boots
// ride the BAKED contract (twin-bake.ts) and never import it. The
// primmel-ts import is LAZY (a build-time-only tool): the package
// need not be present for typecheck or for any baked-contract path
// (CI runs without the private primmel-ts checkout).
import type { TwinContract, TwinOperation, ServeDeclaration } from './twin-contract.js'

type LoadPackage = (dir: string) => Promise<unknown>
const PRIMMEL_SPEC = '@primmel/primmel'
let cached: LoadPackage | undefined
async function primmelLoad(): Promise<LoadPackage> {
  if (!cached) {
    // non-literal specifier: TS must not require the module statically
    const mod = await import(PRIMMEL_SPEC).catch(() => {
      throw new Error(
        '@primmel/primmel is not installed — the .prl adapter is a build-time tool. ' +
        'Point the primmel-ts checkout at it (the @primmel/primmel file: dependency), or use the baked contract (twin-bake.ts).',
      )
    }) as { loadPackage: LoadPackage }
    cached = mod.loadPackage
  }
  return cached
}

interface RawOperation { name: string; kind: string; serves?: string[] }
interface RawEndpoint { id: string; operations?: RawOperation[] }
interface RawBinding { aspect: string; via: string; freshWithin?: string }
interface RawSubject { is?: { endpoints?: RawEndpoint[] }; has?: { serves?: RawBinding[] } }

/** ISO-8601-lite duration parsing: '5s', '500ms', '1min', '1h', '1d',
 *  'PT5S', 'PT1M', 'PT1H', 'P1D'. */
export function parseDurationS(d: string): number {
  const m = /^(?:P(?:T)?)?(\d+(?:\.\d+)?)(ms|min|s|h|d|M|H|S|D)?$/i.exec(d.trim())
  if (!m) throw new Error(`unparsable duration '${d}'`)
  const n = Number(m[1])
  switch ((m[2] ?? 's').toLowerCase()) {
    case 'ms': return n / 1000
    case 'min': case 'm': return n * 60
    case 's': return n
    case 'h': return n * 3600
    case 'd': return n * 86400
    default: throw new Error(`unparsable duration unit in '${d}'`)
  }
}

const OP_KIND: Record<string, TwinOperation['kind']> = { query: 'query', subscribe: 'watch', invoke: 'command' }

/** Parse a product package into the serve contract: operations from
 *  the subject's endpoint declarations (kind-mapped), serves from the
 *  HAS-level bindings + every operation-served register (uncovered
 *  registers inherit their operation's binding freshness). */
export async function parseTwinContract(pkgDir: string): Promise<TwinContract> {
  const loadPackage = await primmelLoad()
  const pkg = await loadPackage(pkgDir) as { packageManifest?: { id?: string }; subjects?: RawSubject[]; subject?: RawSubject }
  const subject = pkg.subjects?.[0] ?? pkg.subject ?? {}
  const endpoints: RawEndpoint[] = subject.is?.endpoints ?? []
  const bindings: RawBinding[] = subject.has?.serves ?? []

  const operations: TwinOperation[] = []
  const serves: ServeDeclaration[] = []
  for (const ep of endpoints) {
    for (const op of ep.operations ?? []) {
      operations.push({ id: op.name, kind: OP_KIND[op.kind] ?? 'query' })
    }
  }
  const opServes = new Map<string, string[]>()
  for (const ep of endpoints) for (const op of ep.operations ?? []) opServes.set(op.name, op.serves ?? [])

  const covered = new Set<string>()
  for (const b of bindings) {
    const registers = opServes.get(b.via) ?? []
    const target = b.aspect === 'sample.state' ? 'state'
      : registers.length === 1 ? registers[0]!
      : registers.find(r => b.aspect.endsWith(r)) ?? registers[0] ?? b.aspect
    const key = `${target}@${b.via}`
    if (covered.has(key)) continue
    covered.add(key)
    serves.push({ target, via: b.via, ...(b.freshWithin ? { freshWithinS: parseDurationS(b.freshWithin) } : {}) })
  }
  // registers an operation serves that no binding names explicitly
  // (e.g. environmental_context) inherit the operation's binding freshness
  for (const op of operations) {
    const binding = bindings.find(b => b.via === op.id)
    for (const reg of opServes.get(op.id) ?? []) {
      const key = `${reg}@${op.id}`
      if (covered.has(key)) continue
      covered.add(key)
      serves.push({
        target: reg, via: op.id,
        ...(binding?.freshWithin ? { freshWithinS: parseDurationS(binding.freshWithin) } : {}),
      })
    }
  }

  return { instrumentId: pkg.packageManifest?.id ?? endpoints[0]?.id ?? 'unknown', serves, operations }
}
