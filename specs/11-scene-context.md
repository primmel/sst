# SST SceneContext — the instance's scene.ts binding protocol

> **Status:** normative. Implementation: `packages/runtime/sst-runtime/src/scene/`.

The instance package carries BOTH the simulation physics (`behavior.ts`) AND the 3D interactivity (`scene.ts`). Only the manufacturer knows their device's behavior and how their 3D model should respond — putting either in the runtime violates OCP; putting either in the kind forces all instances of a kind to share, which doesn't match reality.

## The manufacturer-knows rule

| Lives in `behavior.ts` | Lives in `scene.ts` |
|---|---|
| The creep curve | Which nodes are draggable |
| The hysteresis shape | Which nodes are buttons |
| The temperature coefficients | How a calibration mass drops onto a pan |
| The calibration map | What hover/click gestures do |
| The failure modes | The geometry of "over the pan" |

## The instance package shape

```
packages/instances/<id>/
  package.sst.yaml
  coefficients.yaml
  samples/*.yaml
  src/
    behavior.ts        implements Kind's behavior interface (simulation physics)
    scene.ts           implements Kind's scene interface (3D interactivity)
  behavior.js          bundled behavior + scene (esbuild output)
  model.glb
```

## The kind's interface declares both contracts

```ts
// packages/kinds/sst-r60/interface.d.ts
import type { SceneContext } from '@primmel/sst-runtime/scene/context'
import type { GltfScene } from '@primmel/sst-runtime/scene/gltf'

export interface R60Behavior {
  create(def: R60Definition, clock: VirtualClock, seed: number): R60Instrument
  handlers: { /* one per mutation declared in world-kind.yaml */ }
}

export interface R60Scene {
  /** Bind mouse/keyboard/touch events on the loaded glTF scene to simulation actions.
   *  Returns an unbind function called on session close. */
  bind(scene: GltfScene, ctx: SceneContext<R60Instrument>): () => void
}

/** The kind requires BOTH behavior AND scene from every instance. */
export interface R60Instance {
  behavior: R60Behavior
  scene: R60Scene
}
```

## The SceneContext — the runtime's gift to the instance's scene.ts

```ts
export interface SceneContext<I> {
  /** Direct in-process method access to the running instrument. */
  instrument: I

  /** The typed client driver for the /twin endpoint (legal reads + commands). */
  twin: TwinDriver

  /** The typed client driver for the /world endpoint (mutations + ground truth). */
  world: WorldDriver

  /** The virtual clock driving the simulation. */
  clock: VirtualClock
}
```

The runtime constructs the SceneContext at session boot and passes it to the instance's `scene.bind(gltf, ctx)`. The instance decides what to do with it.

## Two-way interactivity

- **Sim → 3D**: the simulation state drives the scene's deformation/animation (the cell compresses with strain; the weight settles on the pan). This is wired via the kind's `bench.yaml:scene_3d.deformations`.
- **3D → sim**: the user's mouse/keyboard/touch on the 3D scene drives simulation actions. This is wired via the instance's `scene.bind()`.

## The GltfScene abstraction

The instance's `scene.ts` programs against the `GltfScene` interface, never against WebGL directly. The runtime's bench-side loader (TODO 04/05) implements `GltfScene` against raw WebGL2; future hosts (a Three.js renderer, a WebGPU renderer, a VR host) can implement it differently without changing any instance package.

```ts
export interface GltfScene {
  onDown(nodeSubstring: string, handler: (e: ScenePointerEvent) => void): () => void
  onUp(nodeSubstring: string, handler: (e: ScenePointerEvent) => void): () => void
  onClick(nodeSubstring: string, handler: (e: ScenePointerEvent) => void): () => void
  onDrag(nodeSubstring: string, handler: (e: ScenePointerEvent) => void): () => void
  onHover(nodeSubstring: string, handler: (e: ScenePointerEvent) => void): () => void

  nodePosition(nodeName: string): { x: number; y: number; z: number } | null
  isOver(worldPos: { x: number; y: number; z: number }, regionSubstring: string): boolean
}
```

A `NULL_GLTF_SCENE` constant is provided for tests and headless contexts (every method no-ops).

## Example binding (ACME LC-500)

```ts
// packages/instances/acme-lc500/src/scene.ts
import type { R60Scene, SceneContext, R60Instrument } from '../../../sst-r60/interface.d.ts'

export const scene: R60Scene = {
  bind(gltf, ctx: SceneContext<R60Instrument>) {
    // Drag the calibration mass onto the pan:
    const offWeightDrag = gltf.onDrag('weight', (e) => {
      if (gltf.isOver({ x: e.worldX, y: e.worldY, z: e.worldZ }, 'pan')) {
        ctx.world.placeLoad(40)        // via the WorldDriver
      } else {
        ctx.world.removeLoad()
      }
    })

    // Click the zero button on the instrument body:
    const offZeroClick = gltf.onClick('zero-button', () => {
      ctx.twin.runSelfTest()           // via the TwinDriver (the legal view)
    })

    // Drag the temperature dial:
    const offTempDrag = gltf.onDrag('temp-dial', (e) => {
      const current = ctx.instrument.environment().temperatureDegC
      ctx.world.setEnvironment({ temperatureDegC: current + (e.deltaY ?? 0) * 0.5 })
    })

    return () => { offWeightDrag(); offZeroClick(); offTempDrag() }
  }
}
```

## Why this matters

- **The instance is the only tier that knows both the physics and the 3D model's affordances.** Splitting them across tiers breaks the model.
- **Two-way interactivity is non-negotiable.** The 3D scene is a teaching tool, not a movie. Users drop weights, push buttons, twist dials. The simulation must respond.
- **The runtime stays kind- and instance-agnostic.** It loads the glTF, loads the behavior.js, calls `bind(gltf, ctx)`, stores the unbind function. It never knows what specific gestures a particular instance supports.
- **GltfScene is the renderer-abstraction seam.** Today it's WebGL2; tomorrow it could be WebGPU or Three.js. Instance packages don't change.

## Status

- ✅ Spec (this document).
- ✅ Implementation: `packages/runtime/sst-runtime/src/scene/context.ts` + `src/scene/gltf.ts`.
- 🟡 ACME LC-500 instance's `src/scene.ts`: TODO 02's full execution.
- ⬜ The runtime's bench-side GltfScene implementation against raw WebGL2: TODO 04 (Phase 5 — glTF loader).
