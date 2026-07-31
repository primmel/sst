// kinds/boot-strategy.ts — the per-kind boot-strategy registry.
//
// Each kind has its own instrument construction (R 60: ComposedInstrument,
// R 144: SimulatedGasAnalyzer, …), its own world-schema builder, and its
// own TwinIo wiring (the per-component indication registers for the gas
// analyzer, etc.). The boot strategy encapsulates the kind-specific
// pieces; the runtime's boot.ts handles the kind-agnostic pieces
// (loading the contract, enriching with the model, generating the twin
// schema, booting the server).
//
// The OCP win: adding a kind's boot path = adding one entry to
// KIND_BOOT_REGISTRY. The runtime's boot.ts stays kind-agnostic.
//
// Future work: move each strategy into its kind package
// (packages/kinds/<id>/boot.ts) and dynamic-import via the kind
// registry — the true OCP target. The current registry is the
// foundation; it makes the kind-specific code explicit and testable
// rather than branching in boot.ts.

import type { GraphQLSchema } from 'graphql'
import type { VirtualClock } from '../time.js'
import type { TwinIo } from '../twin-schema.js'
import type { LoadedPackage } from '../package-loader.js'
import type { PhysicsChainDecl, InstanceClassification } from '../stages/data-driven.js'
import type { LoadedBehavior } from './behavior-loader.js'

/** The kind-agnostic inputs to a boot strategy. */
export interface KindBootContext {
  instance: LoadedPackage
  clock: VirtualClock
  seed: number
  classification: InstanceClassification
  coefficients: Record<string, number>
  /** The kind's physics-chain.yaml, when present. */
  physicsChain?: PhysicsChainDecl
  /** The chosen sample name (optional override; defaults to the kind's default). */
  sample?: string
  /** The kind package's directory (for reading world-kind.yaml etc.). */
  kindDir?: string | undefined
}

/** The kind-specific outputs of a boot strategy. */
export interface KindBootResult {
  /** The kind-specific instrument (from behavior.create or legacy construction). */
  instrument: unknown
  /** The /world schema for this kind. */
  worldSchema: GraphQLSchema
  /**
   * Optional pre-built TwinIo. When absent, boot.ts builds TwinIo
   * generically via buildTwinIo(instrument, clock, contract, behavior).
   * Strategies may still supply twinIo for the legacy path.
   */
  twinIo?: TwinIo
  /** The loaded behavior module, when the plug-and-play path was used. */
  behavior?: LoadedBehavior
}

/** A kind's boot strategy — encapsulates the kind-specific construction.
 *  Async because the world-schema assembler dynamically imports the
 *  kind's handlers.ts. */
export interface KindBootStrategy {
  kindId: string
  boot(ctx: KindBootContext): Promise<KindBootResult>
}

const KIND_BOOT_REGISTRY = new Map<string, KindBootStrategy>()

/** Register a kind's boot strategy. Idempotent. */
export function registerKindBootStrategy(strategy: KindBootStrategy): void {
  KIND_BOOT_REGISTRY.set(strategy.kindId, strategy)
}

/** Look up a kind's boot strategy. Throws with a precise message when
 *  a kind hasn't been wired yet — listing the registered kinds so the
 *  gap is obvious. */
export function lookupKindBootStrategy(kindId: string): KindBootStrategy {
  const s = KIND_BOOT_REGISTRY.get(kindId)
  if (!s) {
    throw new Error(
      `no boot strategy registered for kind '${kindId}' — wired: ${[...KIND_BOOT_REGISTRY.keys()].join(', ') || '(none)'}. ` +
      `Add an entry to KIND_BOOT_REGISTRY in packages/runtime/sst-runtime/src/kinds/boot-strategy-*.ts.`,
    )
  }
  return s
}

/** All registered kind ids (for diagnostics). */
export function listBootableKinds(): string[] {
  return [...KIND_BOOT_REGISTRY.keys()]
}
