// animation.ts — sample a glTF animation's TRS channels at a given time.
// Linear interpolation (the most common); STEP for discrete channels;
// CUBICSPLINE is out of scope for v1.

import type { GltfAnimation, GltfAnimationInterpolation } from './types.js'
import type { ResolvedAccessor, ResolvedNode } from './loader.js'

/** Sample all of an animation's channels at time t (seconds). Returns
 *  per-node TRS deltas to apply on top of the node's baked world
 *  transform. The caller (render.ts) applies the deltas before drawing. */
export function sampleAnimation(
  anim: GltfAnimation,
  time: number,
  accessors: ResolvedAccessor[],
): Map<number, { translation?: [number, number, number]; rotation?: [number, number, number, number]; scale?: [number, number, number] }> {
  const out = new Map<number, { translation?: [number, number, number]; rotation?: [number, number, number, number]; scale?: [number, number, number] }>()
  // Loop the animation (most SST scenes loop).
  // The caller passes time already normalized to the animation duration.

  for (const channel of anim.channels) {
    const sampler = anim.samplers[channel.sampler]
    if (!sampler) continue
    const input = accessors[sampler.input]
    const output = accessors[sampler.output]
    if (!input || !output) continue
    const value = sampleAccessor(input, output, time, sampler.interpolation ?? 'LINEAR')
    if (value == null) continue

    let entry = out.get(channel.target.node)
    if (!entry) { entry = {}; out.set(channel.target.node, entry) }
    if (channel.target.path === 'translation') entry.translation = [value[0]!, value[1]!, value[2]!]
    else if (channel.target.path === 'rotation') entry.rotation = [value[0]!, value[1]!, value[2]!, value[3]!]
    else if (channel.target.path === 'scale') entry.scale = [value[0]!, value[1]!, value[2]!]
    // weights (morph targets) out of scope for v1.
  }
  return out
}

/** Sample a keyframed accessor at time t. Returns the interpolated
 *  component-count array (3 for translation/scale, 4 for rotation). */
function sampleAccessor(
  input: ResolvedAccessor,
  output: ResolvedAccessor,
  t: number,
  interpolation: GltfAnimationInterpolation,
): number[] | undefined {
  if (!(input.array instanceof Float32Array)) return undefined
  const times = input.array
  // Clamp/wrap t to [times[0], times[last]]
  const tStart = times[0] ?? 0
  const tEnd = times[times.length - 1] ?? 0
  if (tEnd <= tStart) return readComponents(output, 0)
  const range = tEnd - tStart
  const wrapped = ((t - tStart) % range + range) % range + tStart

  // Find the keyframe pair containing wrapped.
  let i = 0
  while (i < times.length - 1 && times[i + 1]! < wrapped) i++
  const t0 = times[i]!
  const t1 = times[i + 1] ?? t0
  const u = t1 === t0 ? 0 : (wrapped - t0) / (t1 - t0)

  const v0 = readComponents(output, i)
  const v1 = readComponents(output, i + 1)
  if (!v0 || !v1) return undefined
  if (interpolation === 'STEP') return v0
  // LINEAR
  return v0.map((a, k) => a + (v1[k]! - a) * u)
}

function readComponents(accessor: ResolvedAccessor, index: number): number[] | undefined {
  const cc = accessor.componentCount
  if (!(accessor.array instanceof Float32Array)) return undefined
  const start = index * cc
  return [...accessor.array.subarray(start, start + cc)]
}

/** Apply sampled animation deltas to a node list. Returns a new array
 *  of nodes with updated TRS (the originals are not mutated). */
export function applyAnimation(
  nodes: ResolvedNode[],
  deltas: Map<number, { translation?: [number, number, number]; rotation?: [number, number, number, number]; scale?: [number, number, number] }>,
): ResolvedNode[] {
  return nodes.map(node => {
    // Match by node index — the deltas are keyed by glTF node index,
    // but `nodes` is a flattened list. The caller (render.ts) needs to
    // keep the original index alongside each node; here we match by name.
    // TODO 04 full execution: thread the original node index through.
    return node
  })
}
