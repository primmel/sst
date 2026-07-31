// stages/stage-interface.ts — the generic Stage port-key interface.
//
// Every physics stage registered with STAGE_REGISTRY conforms to this
// interface. The composer pipes port-keyed values between stages; each
// stage declares its consumes/produces ports in physics-chain.yaml.

import type { Environment } from '../instrument.js'

export type PortMap = Record<string, number>

export interface TickContext {
  /** Time-step for this tick, in seconds. */
  dtS: number
  /** The current environment (temperature, humidity, pressure). */
  env: Environment
  /** The virtual clock's current time, in seconds. */
  nowS: number
}

export interface Stage {
  /** Consume inputs from the port map; return outputs to add to the port map. */
  process(inputs: PortMap, ctx: TickContext): PortMap
}

export interface StageFactory<P = { coefficients: Record<string, number>; seed: number }> {
  stageKey: string
  create(params: P): Stage
}

export type { Environment }
