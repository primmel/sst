import { describe, it, expect } from 'vitest'
import { loadGlb } from '../src/loader.js'
import type { GltfJson } from '../src/types.js'
import { GLB_MAGIC, GLB_VERSION, GLB_CHUNK_JSON, GLB_CHUNK_BIN } from '../src/types.js'

/** Build a minimal valid GLB with the given JSON + BIN payload. */
function buildGlb(json: GltfJson, binIn: Uint8Array): Uint8Array {
  // Pad JSON to 4-byte alignment with spaces; pad BIN with zeros.
  const jsonBytes = new TextEncoder().encode(JSON.stringify(json))
  const jsonPad = (4 - (jsonBytes.length % 4)) % 4
  const jsonPadded = new Uint8Array(jsonBytes.length + jsonPad)
  jsonPadded.set(jsonBytes, 0)
  for (let i = jsonBytes.length; i < jsonPadded.length; i++) jsonPadded[i] = 0x20

  const binPad = (4 - (binIn.length % 4)) % 4
  const bin = new Uint8Array(binIn.length + binPad)
  bin.set(binIn, 0)

  const headerBytes = 12
  const jsonChunkHeader = 8
  const binChunkHeader = 8
  const totalLength = headerBytes + jsonChunkHeader + jsonPadded.length + binChunkHeader + bin.length

  const out = new Uint8Array(totalLength)
  const dv = new DataView(out.buffer)
  dv.setUint32(0, GLB_MAGIC, true)
  dv.setUint32(4, GLB_VERSION, true)
  dv.setUint32(8, totalLength, true)

  // JSON chunk
  let off = 12
  dv.setUint32(off, jsonPadded.length, true); off += 4
  dv.setUint32(off, GLB_CHUNK_JSON, true); off += 4
  out.set(jsonPadded, off); off += jsonPadded.length

  // BIN chunk
  dv.setUint32(off, bin.length, true); off += 4
  dv.setUint32(off, GLB_CHUNK_BIN, true); off += 4
  out.set(bin, off)

  return out
}

describe('@primmel/sst-gltf — GLB loader', () => {
  it('parses a minimal GLB with one triangle mesh', () => {
    // Three vertices, one triangle, no indices.
    // POSITION accessor: 3 × VEC3 FLOAT = 36 bytes.
    const positions = new Float32Array([
      0, 0, 0,
      1, 0, 0,
      0, 1, 0,
    ])
    const bin = new Uint8Array(positions.buffer, positions.byteOffset, positions.byteLength)
    const json: GltfJson = {
      asset: { version: '2.0', generator: 'sst-gltf test' },
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [{ name: 'triangle', mesh: 0 }],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
      accessors: [{
        componentType: 5126, count: 3, type: 'VEC3',
        bufferView: 0,
        min: [0, 0, 0], max: [1, 1, 0],
      }],
      bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36, target: 34962 }],
      buffers: [{ byteLength: 36 }],
    }

    const glb = buildGlb(json, bin.slice())
    const model = loadGlb(glb)

    expect(model.asset.version).toBe('2.0')
    expect(model.sceneNodes.length).toBe(1)
    expect(model.sceneNodes[0]!.name).toBe('triangle')
    expect(model.sceneNodes[0]!.primitives?.length).toBe(1)
    const pos = model.sceneNodes[0]!.primitives![0]!.POSITION
    expect(pos.count).toBe(3)
    expect(pos.componentCount).toBe(3)
    expect(Array.from(pos.array as Float32Array)).toEqual(Array.from(positions))
  })

  it('rejects non-GLB input', () => {
    // 24 bytes (passes the length check) but wrong magic.
    const notGlb = new Uint8Array(24)
    notGlb[0] = 1; notGlb[1] = 2; notGlb[2] = 3; notGlb[3] = 4
    expect(() => loadGlb(notGlb)).toThrow(/not a GLB container/)
  })

  it('rejects input too short to be a GLB', () => {
    expect(() => loadGlb(new Uint8Array([1, 2, 3, 4, 5]))).toThrow(/GLB too short/)
  })

  it('rejects unsupported glTF version', () => {
    const json = { asset: { version: '1.0' } } as unknown as GltfJson
    const glb = buildGlb(json, new Uint8Array(0))
    expect(() => loadGlb(glb)).toThrow(/unsupported glTF version/)
  })

  it('flattens a 2-node hierarchy with a parent transform', () => {
    // Parent at translation (10, 0, 0); child at translation (0, 5, 0).
    // Child's world translation should be (10, 5, 0).
    const json: GltfJson = {
      asset: { version: '2.0' },
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [
        { name: 'parent', translation: [10, 0, 0], children: [1] },
        { name: 'child', translation: [0, 5, 0] },
      ],
    }
    const glb = buildGlb(json, new Uint8Array(0))
    const model = loadGlb(glb)
    expect(model.sceneNodes.length).toBe(2)
    const child = model.sceneNodes.find(n => n.name === 'child')
    expect(child?.translation).toEqual([10, 5, 0])
  })

  it('reads animation duration from sampler inputs', () => {
    const times = new Float32Array([0, 1.5, 4.2])
    const bin = new Uint8Array(times.buffer, times.byteOffset, times.byteLength)
    const json: GltfJson = {
      asset: { version: '2.0' },
      scene: 0,
      scenes: [{ nodes: [] }],
      accessors: [{ componentType: 5126, count: 3, type: 'SCALAR', bufferView: 0 }],
      bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 12 }],
      buffers: [{ byteLength: 12 }],
      animations: [{
        samplers: [{ input: 0, output: 0 }],
        channels: [{ sampler: 0, target: { node: 0, path: 'translation' } }],
      }],
    }
    const glb = buildGlb(json, bin.slice())
    const model = loadGlb(glb)
    expect(model.animationDurationS).toBeCloseTo(4.2, 5)
  })
})
