// kinds/boot-from-behavior.ts — the generic plug-and-play boot path.
//
// When an instance package ships a behavior.js, this path:
//   1. Loads + validates the behavior module
//   2. Builds a definition from the package's data files
//   3. Calls behavior.create(def, clock, seed) → instrument
//   4. Assembles the /world schema from the kind's YAML/SDL/handlers
//   5. Returns instrument + worldSchema (TwinIo is built later once
//      the contract is loaded, via buildTwinIo)
//
// Kind-specific boot strategies try this first; if no behavior is
// present they fall back to their legacy construction.

import type { VirtualClock } from '../time.js'
import type { GraphQLSchema } from 'graphql'
import type { LoadedPackage } from '../package-loader.js'
import type { PhysicsChainDecl, InstanceClassification } from '../stages/data-driven.js'
import { buildWorldSchemaFromKind } from './world-schema-assembler.js'
import { hasBehavior, loadBehavior, type LoadedBehavior } from './behavior-loader.js'
import { buildInstanceDefinition } from './definition-builder.js'

export interface BehaviorBootInput {
  instance: LoadedPackage
  clock: VirtualClock
  seed: number
  classification: InstanceClassification
  coefficients: Record<string, number>
  kindDir: string
  physicsChain?: PhysicsChainDecl
  sample?: string
}

export interface BehaviorBootResult {
  instrument: unknown
  worldSchema: GraphQLSchema
  behavior: LoadedBehavior
}

/**
 * Attempt the plug-and-play boot path. Returns null when:
 *   - the instance has no behavior module, OR
 *   - the behavior module fails to load (e.g. ZIP extract outside the
 *     monorepo can't resolve relative family imports until bundled).
 *
 * Callers fall back to legacy construction in those cases.
 */
export async function tryBootFromBehavior(
  input: BehaviorBootInput,
): Promise<BehaviorBootResult | null> {
  const manifestBehavior = input.instance.manifest.behavior
  if (!hasBehavior(input.instance.rootPath, manifestBehavior)) return null

  let behavior: LoadedBehavior
  try {
    behavior = await loadBehavior(input.instance.rootPath, manifestBehavior)
  } catch (err) {
    // Import resolution failure (unbundled behavior outside monorepo).
    console.warn(
      `tryBootFromBehavior: could not load behavior from ${input.instance.rootPath}: ${(err as Error).message} — falling back to legacy construction`,
    )
    return null
  }

  const def = await buildInstanceDefinition({
    instance: input.instance,
    coefficients: input.coefficients,
    classification: input.classification as Record<string, string | undefined>,
    ...(input.physicsChain ? { physicsChain: input.physicsChain } : {}),
    ...(input.sample ? { sample: input.sample } : {}),
  })

  let instrument: unknown
  try {
    instrument = behavior.create(def, input.clock, input.seed)
  } catch (err) {
    console.warn(
      `tryBootFromBehavior: behavior.create() failed: ${(err as Error).message} — falling back to legacy construction`,
    )
    return null
  }

  if (instrument == null || typeof instrument !== 'object') {
    throw new Error(
      `behavior.create() at ${behavior.sourcePath} returned ${instrument === null ? 'null' : typeof instrument} — expected an instrument object`,
    )
  }

  // Require the universal TwinInstrumentView surface: servedAt (the
  // freshness timestamp) and operationalState (the legal state). The
  // kind-specific readers (indication, sampleFlow, etc.) are validated
  // when the twin schema is generated — generateTwinSchema throws if a
  // declared serve has no reader on the instrument.
  for (const method of ['servedAt', 'operationalState'] as const) {
    if (typeof (instrument as Record<string, unknown>)[method] !== 'function') {
      throw new Error(
        `behavior.create() at ${behavior.sourcePath} produced an instrument missing ${method}() — ` +
        `the kind's interface requires the TwinInstrumentView surface`,
      )
    }
  }

  const host = {
    instrument,
    clock: input.clock,
    swap() { /* scenarios are not swappable when behavior owns the instrument */ },
  }

  const worldSchema = await buildWorldSchemaFromKind(
    input.kindDir,
    host as never,
    {} as never,
  )

  return { instrument, worldSchema, behavior }
}
