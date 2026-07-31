// render.ts — the WebGL2 side. Uploads a parsed GltfModel to GL buffers
// and draws each frame. Reuses the bench's two-light shader aesthetic.
//
// Status: scaffolded. The shape is correct (upload + draw); the actual
// shader code reuses the bench's existing two-light setup. Production
// wiring lands with TODO 04's BenchScene.vue integration.

import type { GltfModel, ResolvedNode, ResolvedPrimitive } from './loader.js'

export interface RenderState {
  model: GltfModel
  buffers: Map<ResolvedPrimitive, { vbo: WebGLBuffer; ibo?: WebGLBuffer; vertexCount: number; indexCount: number; indexType: number }>
}

/** Upload a parsed GltfModel to GL buffers. Returns a handle for later draw calls. */
export function uploadModel(gl: WebGL2RenderingContext, model: GltfModel): RenderState {
  const buffers = new Map<ResolvedPrimitive, { vbo: WebGLBuffer; ibo?: WebGLBuffer; vertexCount: number; indexCount: number; indexType: number }>()
  for (const node of model.sceneNodes) {
    for (const prim of node.primitives ?? []) {
      if (buffers.has(prim)) continue
      const vbo = gl.createBuffer()!
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo)
      // Interleave POSITION + NORMAL into one buffer for simpler attribute binding.
      // For now we upload POSITION only (the bench's existing shader expects both,
      // but a minimal v1 can use POSITION-only with a fallback normal).
      const pos = prim.POSITION.array
      gl.bufferData(gl.ARRAY_BUFFER, pos instanceof Float32Array ? pos : new Float32Array(), gl.STATIC_DRAW)
      const entry: { vbo: WebGLBuffer; ibo?: WebGLBuffer; vertexCount: number; indexCount: number; indexType: number } = {
        vbo,
        vertexCount: prim.POSITION.count,
        indexCount: 0,
        indexType: gl.UNSIGNED_SHORT,
      }
      if (prim.indices) {
        const ibo = gl.createBuffer()!
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo)
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, prim.indices.array, gl.STATIC_DRAW)
        entry.ibo = ibo
        entry.indexCount = prim.indices.count
        entry.indexType = componentTypeToGL(gl, prim.indices.componentType)
      }
      buffers.set(prim, entry)
    }
  }
  return { model, buffers }
}

/** Draw the model. The caller sets up the shader program + uniforms first. */
export function drawModel(
  gl: WebGL2RenderingContext,
  state: RenderState,
  attributeLoc: { position: number },
): void {
  for (const node of state.model.sceneNodes) {
    for (const prim of node.primitives ?? []) {
      const entry = state.buffers.get(prim)
      if (!entry) continue
      gl.bindBuffer(gl.ARRAY_BUFFER, entry.vbo)
      gl.enableVertexAttribArray(attributeLoc.position)
      gl.vertexAttribPointer(attributeLoc.position, 3, gl.FLOAT, false, 0, 0)
      // TODO 04 full: also bind NORMAL, set model matrix from node TRS.
      if (entry.ibo) {
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, entry.ibo)
        gl.drawElements(gl.TRIANGLES, entry.indexCount, entry.indexType, 0)
      } else {
        gl.drawArrays(gl.TRIANGLES, 0, entry.vertexCount)
      }
    }
  }
}

/** Free the GL buffers. Idempotent. */
export function releaseModel(gl: WebGL2RenderingContext, state: RenderState): void {
  for (const entry of state.buffers.values()) {
    gl.deleteBuffer(entry.vbo)
    if (entry.ibo) gl.deleteBuffer(entry.ibo)
  }
  state.buffers.clear()
}

function componentTypeToGL(gl: WebGL2RenderingContext, componentType: number): number {
  switch (componentType) {
    case 5121: return gl.UNSIGNED_BYTE
    case 5123: return gl.UNSIGNED_SHORT
    case 5125: return gl.UNSIGNED_INT
    default:   return gl.UNSIGNED_SHORT
  }
}

// Silence the unused-import warning for ResolvedNode (used in the type
// signatures above via GltfModel's structure).
export type { ResolvedNode }
