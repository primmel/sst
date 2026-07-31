// scene/context.ts — the SceneContext the runtime constructs at session
// boot and passes to the instance's scene.bind(). Carries the running
// instrument, the TwinDriver (legal reads), the WorldDriver (mutations
// + ground truth), and the virtual clock.

import type { TwinDriver } from '../twin/driver.js'
import type { WorldDriver } from '../world/driver.js'
import type { VirtualClock } from '../index.js'

/** The context the instance's scene.bind receives. Gives the instance's
 *  scene.ts controlled access to both channels and the in-process
 *  instrument — enough to wire 3D user input to simulation actions
 *  without exposing runtime internals. */
export interface SceneContext<I> {
  /** Direct in-process method access to the running instrument. */
  instrument: I

  /** The typed client driver for /twin (legal reads + commands). */
  twin: TwinDriver

  /** The typed client driver for /world (mutations + ground truth). */
  world: WorldDriver

  /** The virtual clock driving the simulation. */
  clock: VirtualClock
}

/** Construct a SceneContext. The runtime calls this at session boot. */
export function createSceneContext<I>(
  instrument: I,
  twin: TwinDriver,
  world: WorldDriver,
  clock: VirtualClock,
): SceneContext<I> {
  return { instrument, twin, world, clock }
}
