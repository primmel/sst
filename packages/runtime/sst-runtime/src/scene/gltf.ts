// scene/gltf.ts — the abstraction the instance's scene.bind() receives.
// The runtime's bench-side loader (Phase 5) implements this interface
// against raw WebGL2; the instance's scene.ts programs against this
// abstraction, never against WebGL directly. This decoupling is what
// lets a single instance package target both the shell's bench and any
// future host that loads the glTF differently.

/** A 2D or 3D pointer event on the glTF scene. */
export interface ScenePointerEvent {
  /** The hit node's name (or null if the pointer missed all nodes). */
  node: string | null
  /** Pointer position in screen pixels. */
  screenX: number
  screenY: number
  /** Pointer position in world coordinates (meters, scene's local frame). */
  worldX: number
  worldY: number
  worldZ: number
  /** Delta from the previous event (for drag handlers). */
  deltaX?: number
  deltaY?: number
  deltaZ?: number
}

/** The glTF scene abstraction the instance's scene.bind receives. */
export interface GltfScene {
  /** Subscribe to pointer-down events. Returns an unbind function. */
  onDown(nodeSubstring: string, handler: (e: ScenePointerEvent) => void): () => void
  /** Subscribe to pointer-up events. */
  onUp(nodeSubstring: string, handler: (e: ScenePointerEvent) => void): () => void
  /** Subscribe to click events (down + up on the same node). */
  onClick(nodeSubstring: string, handler: (e: ScenePointerEvent) => void): () => void
  /** Subscribe to drag events (down + move while held). */
  onDrag(nodeSubstring: string, handler: (e: ScenePointerEvent) => void): () => void
  /** Subscribe to hover events (pointer move without button held). */
  onHover(nodeSubstring: string, handler: (e: ScenePointerEvent) => void): () => void

  /** Read a node's world position. */
  nodePosition(nodeName: string): { x: number; y: number; z: number } | null

  /** Test whether a world position is "over" a named region (for
   *  isOverPan()-style checks). The region is matched by node-name
   *  substring against the loaded scene's bounding boxes. */
  isOver(worldPos: { x: number; y: number; z: number }, regionSubstring: string): boolean
}

/** A no-op stub GltfScene for tests and headless contexts. */
export const NULL_GLTF_SCENE: GltfScene = {
  onDown:   () => () => {},
  onUp:     () => () => {},
  onClick:  () => () => {},
  onDrag:   () => () => {},
  onHover:  () => () => {},
  nodePosition: () => null,
  isOver:   () => false,
}
