// types.ts — glTF 2.0 spec subset. We support:
//   - meshes with POSITION + NORMAL + indices (the only attributes we render)
//   - single base-color PBR material (no textures)
//   - node TRS transforms (no matrices for now)
//   - animation channels driving TRS (linear interpolation)
// Out of scope: PBR textures, skins, morph targets, cameras, extensions,
// sparse accessors. Adding any of these is a future TODO.

export type GltfComponentType = 5120 | 5121 | 5122 | 5123 | 5125 | 5126
// BYTE=5120, UNSIGNED_BYTE=5121, SHORT=5122, UNSIGNED_SHORT=5123,
// UNSIGNED_INT=5125, FLOAT=5126

export type GltfAccessorType =
  | 'SCALAR' | 'VEC2' | 'VEC3' | 'VEC4' | 'MAT2' | 'MAT3' | 'MAT4'

export interface GltfAccessor {
  bufferView?: number
  byteOffset?: number
  componentType: GltfComponentType
  count: number
  type: GltfAccessorType
  normalized?: boolean
  min?: number[]
  max?: number[]
  // Sparse accessors are out of scope for v1.
}

export interface GltfBufferView {
  buffer: number
  byteOffset?: number
  byteLength: number
  byteStride?: number
  target?: 34962 | 34963   // ARRAY_BUFFER | ELEMENT_ARRAY_BUFFER
}

export interface GltfBuffer {
  byteLength: number
  // We resolve the buffer to a Uint8Array at load time. The glTF spec
  // allows `uri` for embedded base64 or external; the GLB container has
  // an explicit BIN chunk instead.
  uri?: string
}

export interface GltfPrimitive {
  attributes: { POSITION: number; NORMAL?: number; TEXCOORD_0?: number }
  indices?: number
  material?: number
  mode?: number             // drawing mode; default 4 (TRIANGLES)
}

export interface GltfMesh {
  primitives: GltfPrimitive[]
  name?: string
}

export interface GltfNode {
  name?: string
  children?: number[]
  mesh?: number
  translation?: [number, number, number]
  rotation?: [number, number, number, number]    // quaternion (x, y, z, w)
  scale?: [number, number, number]
  // Matrix is supported on import; converted to TRS at load time.
}

export interface GltfScene {
  nodes?: number[]
  name?: string
}

export type GltfAnimationInterpolation = 'LINEAR' | 'STEP' | 'CUBICSPLINE'

export interface GltfAnimationSampler {
  input: number              // accessor index (keyframe times)
  output: number             // accessor index (keyframe values)
  interpolation?: GltfAnimationInterpolation
}

export interface GltfAnimationChannel {
  sampler: number
  target: { node: number; path: 'translation' | 'rotation' | 'scale' | 'weights' }
}

export interface GltfAnimation {
  samplers: GltfAnimationSampler[]
  channels: GltfAnimationChannel[]
  name?: string
}

export interface GltfMaterial {
  name?: string
  pbrMetallicRoughness?: {
    baseColorFactor?: [number, number, number, number]
    metallicFactor?: number
    roughnessFactor?: number
  }
  doubleSided?: boolean
}

export interface GltfAsset {
  version: string
  generator?: string
  copyright?: string
}

export interface GltfJson {
  asset: GltfAsset
  scene?: number
  scenes?: GltfScene[]
  nodes?: GltfNode[]
  meshes?: GltfMesh[]
  materials?: GltfMaterial[]
  accessors?: GltfAccessor[]
  bufferViews?: GltfBufferView[]
  buffers?: GltfBuffer[]
  animations?: GltfAnimation[]
  extensionsRequired?: string[]
  extensionsUsed?: string[]
}

// ── GLB container constants ────────────────────────────────────────────
export const GLB_MAGIC = 0x46546c67       // 'glTF' as little-endian uint32
export const GLB_VERSION = 2
export const GLB_CHUNK_JSON = 0x4e4f534a   // 'JSON'
export const GLB_CHUNK_BIN = 0x004e4942    // 'BIN\0'
