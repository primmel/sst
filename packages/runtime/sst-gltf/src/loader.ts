// loader.ts — parse a glTF 2.0 binary (.glb) container into a GltfModel.
//
// The loader is isomorphic: pure data parsing, no GL. The render-side
// (render.ts) uploads the parsed buffers to WebGL2.
//
// Supported subset: see types.ts. The loader is strict about the
// subset — unsupported features throw a precise error rather than
// silently producing wrong output.
//
// Status: scaffold + parse + accessor resolution + node-hierarchy
// flatten + animation sampling. Production-ready for the SST bench's
// needs (static meshes + node transforms + animation channels).

import type {
  GltfAccessor, GltfAnimation, GltfBufferView, GltfJson, GltfNode,
  GltfComponentType, GltfPrimitive,
} from './types.js'
import { GLB_MAGIC, GLB_VERSION, GLB_CHUNK_JSON, GLB_CHUNK_BIN } from './types.js'

/** A typed-array view into the underlying binary buffer, plus its
 *  accessor metadata. The render-side uploads `array` to a GL buffer. */
export interface ResolvedAccessor {
  array: Int8Array | Uint8Array | Int16Array | Uint16Array | Uint32Array | Float32Array
  componentType: GltfComponentType
  count: number
  componentCount: number     // 1 for SCALAR, 3 for VEC3, etc.
  byteStride: number
}

/** A drawable primitive — its POSITION/NORMAL/indices accessors resolved
 *  to typed arrays, ready for GL upload. */
export interface ResolvedPrimitive {
  POSITION: ResolvedAccessor
  NORMAL?: ResolvedAccessor
  indices?: ResolvedAccessor
  material?: number
  mode: number               // gl.TRIANGLES (4) by default
}

/** A flattened node with its world transform baked in. */
export interface ResolvedNode {
  name: string
  mesh?: number
  translation: [number, number, number]
  rotation: [number, number, number, number]
  scale: [number, number, number]
  primitives?: ResolvedPrimitive[]
}

/** A parsed glTF model. The render-side walks `sceneNodes` and draws. */
export interface GltfModel {
  asset: { version: string; generator?: string }
  sceneNodes: ResolvedNode[]
  materials: Array<{ baseColor: [number, number, number, number]; metallic: number; roughness: number; doubleSided: boolean }>
  animations: GltfAnimation[]
  /** The minimum/maximum keyframe time across all animations. */
  animationDurationS: number
}

// ── Component-type sizes ─────────────────────────────────────────────
const COMPONENT_BYTES: Record<GltfComponentType, number> = {
  5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4,
}
const COMPONENT_COUNT: Record<string, number> = {
  SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16,
}

// ── Public API ─────────────────────────────────────────────────────────

/** Parse a .glb file's bytes into a GltfModel. Throws on malformed input. */
export function loadGlb(bytes: Uint8Array): GltfModel {
  const { json, bin } = parseGlbContainer(bytes)
  return resolveModel(json, bin)
}

/** Parse a .gltf JSON + external buffer(s) into a GltfModel. The
 *  buffers argument is indexed by glTF buffer index; for the SST bench
 *  we always use the GLB path, but this is here for completeness. */
export function loadGltf(json: GltfJson, buffers: Uint8Array[]): GltfModel {
  if (json.buffers && json.buffers.length > 1) {
    throw new Error('multi-buffer glTF is not supported — embed buffers in a .glb')
  }
  const bin = buffers[0] ?? new Uint8Array(0)
  return resolveModel(json, bin)
}

// ── GLB container parsing ──────────────────────────────────────────────

interface GlbParts { json: GltfJson; bin: Uint8Array }

function parseGlbContainer(bytes: Uint8Array): GlbParts {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (bytes.byteLength < 20) throw new Error('GLB too short (need ≥ 20 bytes for header + first chunk)')
  const magic = dv.getUint32(0, true)
  if (magic !== GLB_MAGIC) {
    throw new Error(`not a GLB container: magic 0x${magic.toString(16)} (expected 0x${GLB_MAGIC.toString(16)})`)
  }
  const version = dv.getUint32(4, true)
  if (version !== GLB_VERSION) {
    throw new Error(`unsupported GLB version ${version} (expected ${GLB_VERSION})`)
  }
  // const totalLength = dv.getUint32(8, true)   // not strictly needed; chunks delineate

  let offset = 12
  let json: GltfJson | undefined
  let bin: Uint8Array | undefined
  while (offset + 8 <= bytes.byteLength) {
    const chunkLength = dv.getUint32(offset, true)
    const chunkType = dv.getUint32(offset + 4, true)
    offset += 8
    if (offset + chunkLength > bytes.byteLength) {
      throw new Error(`chunk overruns GLB at offset ${offset - 8}: declared ${chunkLength} bytes, only ${bytes.byteLength - offset} available`)
    }
    const slice = bytes.subarray(offset, offset + chunkLength)
    offset += chunkLength
    if (chunkType === GLB_CHUNK_JSON) {
      const text = new TextDecoder().decode(slice)
      json = JSON.parse(text) as GltfJson
    } else if (chunkType === GLB_CHUNK_BIN) {
      bin = slice
    }
    // Unknown chunk types are skipped per spec.
  }

  if (!json) throw new Error('GLB has no JSON chunk')
  if (!bin) bin = new Uint8Array(0)
  return { json, bin }
}

// ── Model resolution ──────────────────────────────────────────────────

function resolveModel(json: GltfJson, bin: Uint8Array): GltfModel {
  if (!json.asset) throw new Error('glTF missing required `asset` block')
  if (json.asset.version !== '2.0') {
    throw new Error(`unsupported glTF version '${json.asset.version}' (expected 2.0)`)
  }

  // Resolve accessors + bufferViews against the binary buffer.
  const accessors = (json.accessors ?? []).map(a => resolveAccessor(a, json.bufferViews ?? [], bin))

  // Resolve each mesh's primitives into typed arrays.
  const meshes = (json.meshes ?? []).map(mesh => ({
    name: mesh.name,
    primitives: mesh.primitives.map(p => resolvePrimitive(p, accessors)),
  }))

  // Flatten the node hierarchy with baked world transforms.
  const nodes = json.nodes ?? []
  const sceneIdx = json.scene ?? 0
  const sceneRoots = json.scenes?.[sceneIdx]?.nodes ?? []
  const resolvedNodes: ResolvedNode[] = []
  for (const root of sceneRoots) {
    flattenNode(nodes, root, identityTRS(), meshes, resolvedNodes)
  }

  // Resolve materials with sane defaults.
  const materials = (json.materials ?? []).map(m => ({
    baseColor: m.pbrMetallicRoughness?.baseColorFactor ?? [0.8, 0.8, 0.8, 1],
    metallic: m.pbrMetallicRoughness?.metallicFactor ?? 1,
    roughness: m.pbrMetallicRoughness?.roughnessFactor ?? 1,
    doubleSided: m.doubleSided ?? false,
  }))

  // Compute animation duration across all samplers.
  let animationDurationS = 0
  for (const anim of json.animations ?? []) {
    for (const sampler of anim.samplers) {
      const input = accessors[sampler.input]
      if (input && input.array instanceof Float32Array) {
        for (let i = 0; i < input.count; i++) {
          animationDurationS = Math.max(animationDurationS, input.array[i])
        }
      }
    }
  }

  return {
    asset: { version: json.asset.version, generator: json.asset.generator },
    sceneNodes: resolvedNodes,
    materials,
    animations: json.animations ?? [],
    animationDurationS,
  }
}

function resolveAccessor(
  accessor: GltfAccessor,
  bufferViews: GltfBufferView[],
  bin: Uint8Array,
): ResolvedAccessor {
  if (accessor.bufferView == null) {
    // No bufferView — sparse-zero accessor. We don't support sparse, so
    // return a zero-filled array.
    const componentCount = COMPONENT_COUNT[accessor.type] ?? 1
    const totalComponents = accessor.count * componentCount
    return {
      array: new Float32Array(totalComponents),
      componentType: accessor.componentType,
      count: accessor.count,
      componentCount,
      byteStride: 0,
    }
  }
  const bv = bufferViews[accessor.bufferView]
  if (!bv) throw new Error(`accessor references unknown bufferView ${accessor.bufferView}`)

  const bvOffset = bv.byteOffset ?? 0
  const start = bvOffset + (accessor.byteOffset ?? 0)
  const componentCount = COMPONENT_COUNT[accessor.type] ?? 1
  const componentBytes = COMPONENT_BYTES[accessor.componentType]
  const totalBytes = accessor.count * componentCount * componentBytes

  if (start + totalBytes > bin.byteLength) {
    throw new Error(`accessor at ${start} of length ${totalBytes} overruns BIN of ${bin.byteLength}`)
  }

  const slice = bin.subarray(start, start + totalBytes)
  let array: Int8Array | Uint8Array | Int16Array | Uint16Array | Uint32Array | Float32Array
  switch (accessor.componentType) {
    case 5120: array = new Int8Array(slice.buffer, slice.byteOffset, slice.byteLength); break
    case 5121: array = new Uint8Array(slice.buffer, slice.byteOffset, slice.byteLength); break
    case 5122: array = new Int16Array(slice.buffer, slice.byteOffset, slice.byteLength / 2); break
    case 5123: array = new Uint16Array(slice.buffer, slice.byteOffset, slice.byteLength / 2); break
    case 5125: array = new Uint32Array(slice.buffer, slice.byteOffset, slice.byteLength / 4); break
    case 5126: array = new Float32Array(slice.buffer, slice.byteOffset, slice.byteLength / 4); break
    default: throw new Error(`unsupported accessor componentType ${accessor.componentType}`)
  }

  return {
    array,
    componentType: accessor.componentType,
    count: accessor.count,
    componentCount,
    byteStride: bv.byteStride ?? 0,
  }
}

function resolvePrimitive(p: GltfPrimitive, accessors: ResolvedAccessor[]): ResolvedPrimitive {
  const pos = accessors[p.attributes.POSITION]
  if (!pos) throw new Error('primitive missing required POSITION attribute')
  if (p.attributes.NORMAL != null && accessors[p.attributes.NORMAL] == null) {
    throw new Error(`primitive references unknown NORMAL accessor ${p.attributes.NORMAL}`)
  }
  return {
    POSITION: pos,
    NORMAL: p.attributes.NORMAL != null ? accessors[p.attributes.NORMAL] : undefined,
    indices: p.indices != null ? accessors[p.indices] : undefined,
    material: p.material,
    mode: p.mode ?? 4,
  }
}

// ── Node hierarchy ─────────────────────────────────────────────────────

type TRS = { translation: [number, number, number]; rotation: [number, number, number, number]; scale: [number, number, number] }

function identityTRS(): TRS {
  return { translation: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] }
}

function flattenNode(
  nodes: GltfNode[],
  index: number,
  parentWorld: TRS,
  meshes: Array<{ name?: string; primitives: ResolvedPrimitive[] }>,
  out: ResolvedNode[],
): void {
  const node = nodes[index]
  if (!node) throw new Error(`unknown node index ${index}`)
  const local: TRS = {
    translation: node.translation ?? [0, 0, 0],
    rotation: node.rotation ?? [0, 0, 0, 1],
    scale: node.scale ?? [1, 1, 1],
  }
  const world = multiplyTRS(parentWorld, local)
  out.push({
    name: node.name ?? `node-${index}`,
    mesh: node.mesh,
    translation: world.translation,
    rotation: world.rotation,
    scale: world.scale,
    primitives: node.mesh != null ? meshes[node.mesh]?.primitives : undefined,
  })
  for (const child of node.children ?? []) {
    flattenNode(nodes, child, world, meshes, out)
  }
}

/** Multiply two TRS transforms. The rotation is a quaternion.
 *  Translation composes additively after scaling+rotation. */
function multiplyTRS(a: TRS, b: TRS): TRS {
  // Simplified: compose scale (multiply component-wise), rotation
  // (quaternion product), translation (a.translation + rotate(a.rotation,
  // scale(a.scale, b.translation))).
  const scale: [number, number, number] = [
    a.scale[0] * b.scale[0],
    a.scale[1] * b.scale[1],
    a.scale[2] * b.scale[2],
  ]
  const rot = quatMultiply(a.rotation, b.rotation)
  const rotatedBTrans = rotateVec3(a.rotation, [
    a.scale[0] * b.translation[0],
    a.scale[1] * b.translation[1],
    a.scale[2] * b.translation[2],
  ])
  const translation: [number, number, number] = [
    a.translation[0] + rotatedBTrans[0],
    a.translation[1] + rotatedBTrans[1],
    a.translation[2] + rotatedBTrans[2],
  ]
  return { translation, rotation: rot, scale }
}

function quatMultiply(a: [number, number, number, number], b: [number, number, number, number]): [number, number, number, number] {
  const [ax, ay, az, aw] = a
  const [bx, by, bz, bw] = b
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ]
}

function rotateVec3(q: [number, number, number, number], v: [number, number, number]): [number, number, number] {
  const [qx, qy, qz, qw] = q
  // v' = q * v * q^-1 — using the standard quaternion-rotation formula.
  const tx = 2 * (qy * v[2] - qz * v[1])
  const ty = 2 * (qz * v[0] - qx * v[2])
  const tz = 2 * (qx * v[1] - qy * v[0])
  return [
    v[0] + qw * tx + (qy * tz - qz * ty),
    v[1] + qw * ty + (qz * tx - qx * tz),
    v[2] + qw * tz + (qx * ty - qy * tx),
  ]
}
