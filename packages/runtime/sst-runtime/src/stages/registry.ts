// stages/registry.ts — the physics-stage registry.
//
// Each physics stage (MechanicalStage, TransductionStage, etc.) is
// registered here with a unique key. A kind package's physics-chain.yaml
// references stages by key; the runtime looks them up and instantiates
// them with parameters from the instance's coefficients.yaml + the
// chosen sample's overrides.
//
// The registry is the OCP seam for physics phenomena: adding a new
// stage = adding one entry here + a stage file. Existing kinds pick it
// up only if their physics-chain references it.

import type { Stage, StageFactory } from './stage-interface.js'

const STAGE_REGISTRY = new Map<string, StageFactory>()

/** Register a stage factory. Throws if the key is taken. */
export function registerStage(factory: StageFactory): void {
  if (STAGE_REGISTRY.has(factory.stageKey)) {
    throw new Error(`stage '${factory.stageKey}' already registered`)
  }
  STAGE_REGISTRY.set(factory.stageKey, factory)
}

/** Look up a stage by key. Throws if unknown. */
export function lookupStage(stageKey: string): StageFactory {
  const s = STAGE_REGISTRY.get(stageKey)
  if (!s) {
    throw new Error(`unknown stage '${stageKey}' — known: ${[...STAGE_REGISTRY.keys()].join(', ')}`)
  }
  return s
}

/** All registered stage keys (for diagnostics). */
export function listStages(): string[] {
  return [...STAGE_REGISTRY.keys()]
}

export type { Stage, StageFactory }
