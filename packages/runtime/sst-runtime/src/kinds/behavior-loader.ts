// kinds/behavior-loader.ts — load an instance package's behavior.js.
//
// The plug-and-play path: an instance package ships a bundled behavior.js
// that implements the kind's interface (create + optional handlers/
// twinRegisters/twinOperations/scene). The runtime imports it at boot,
// validates the shape, and uses create() to produce the instrument.
//
// Validation is structural (not TypeScript): create must be a function;
// optional handlers must be an object of functions. The kind's
// interface.d.ts is the compile-time contract for authors; at runtime
// we check the load-bearing surface only.

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { VirtualClock } from '../time.js'

/** The runtime shape of a loaded instance behavior. */
export interface LoadedBehavior {
  /** Create a running instrument from a definition + clock + seed. */
  create: (def: unknown, clock: VirtualClock, seed: number) => unknown
  /** Optional instance-level handlers (kind handlers take precedence). */
  handlers?: Record<string, (ctx: unknown, args: Record<string, unknown>) => void>
  /**
   * Optional twin-register factory. When present, used to build TwinIo
   * registers for non-core serve targets (indication_co, dim_volume, …).
   * Prefer this when the instrument's method surface is non-obvious.
   */
  twinRegisters?: (instrument: unknown) => Record<string, () => unknown>
  /**
   * Optional twin-operation factory for command ops
   * (run_self_test, zero_calibration, …).
   */
  twinOperations?: (instrument: unknown) => Record<string, () => void>
  /** Optional 3D scene bindings. */
  scene?: unknown
  /** Absolute path of the loaded module (for diagnostics). */
  sourcePath: string
}

const BEHAVIOR_CANDIDATES = [
  'behavior.js',
  'behavior.mjs',
  'src/behavior.ts',
  'src/behavior.js',
] as const

/**
 * Load an instance package's behavior module.
 *
 * Resolution order (first hit wins):
 *   1. package.sst.yaml `behavior:` path (if present)
 *   2. behavior.js / behavior.mjs at package root
 *   3. src/behavior.ts / src/behavior.js (dev posture via tsx)
 *
 * Throws with a precise message when no behavior is found or the
 * export shape is invalid.
 */
export async function loadBehavior(
  instanceRoot: string,
  manifestBehavior?: string,
): Promise<LoadedBehavior> {
  const candidates: string[] = []
  if (manifestBehavior) candidates.push(join(instanceRoot, manifestBehavior))
  for (const name of BEHAVIOR_CANDIDATES) {
    candidates.push(join(instanceRoot, name))
  }

  let sourcePath: string | undefined
  for (const p of candidates) {
    if (existsSync(p)) { sourcePath = p; break }
  }
  if (!sourcePath) {
    throw new Error(
      `no behavior module in ${instanceRoot} — looked for: ${candidates.map((c) => c.slice(instanceRoot.length + 1)).join(', ')}`,
    )
  }

  const mod = await import(pathToFileURL(sourcePath).href)
  const exported = mod.default ?? mod
  const create = typeof exported.create === 'function'
    ? exported.create
    : typeof mod.create === 'function'
      ? mod.create
      : null

  if (!create) {
    throw new Error(
      `behavior module at ${sourcePath} has no create(def, clock, seed) export ` +
      `(default export keys: ${Object.keys(exported).join(', ') || '(none)'})`,
    )
  }

  const handlers = (exported.handlers ?? mod.handlers) as LoadedBehavior['handlers'] | undefined
  if (handlers != null && typeof handlers !== 'object') {
    throw new Error(`behavior module at ${sourcePath}: handlers must be an object of functions`)
  }
  if (handlers) {
    for (const [name, fn] of Object.entries(handlers)) {
      if (typeof fn !== 'function') {
        throw new Error(`behavior module at ${sourcePath}: handlers.${name} is not a function`)
      }
    }
  }

  return {
    create,
    ...(handlers ? { handlers } : {}),
    ...(typeof (exported.twinRegisters ?? mod.twinRegisters) === 'function'
      ? { twinRegisters: exported.twinRegisters ?? mod.twinRegisters }
      : {}),
    ...(typeof (exported.twinOperations ?? mod.twinOperations) === 'function'
      ? { twinOperations: exported.twinOperations ?? mod.twinOperations }
      : {}),
    ...(exported.scene ?? mod.scene
      ? { scene: exported.scene ?? mod.scene }
      : {}),
    sourcePath,
  }
}

/** True when the instance package has a loadable behavior module. */
export function hasBehavior(instanceRoot: string, manifestBehavior?: string): boolean {
  if (manifestBehavior && existsSync(join(instanceRoot, manifestBehavior))) return true
  return BEHAVIOR_CANDIDATES.some((name) => existsSync(join(instanceRoot, name)))
}
