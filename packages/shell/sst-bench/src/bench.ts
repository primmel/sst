// bench.ts — the virtual bench pane (spec §10): a stylized WebGL2
// scene fed EXCLUSIVELY by /world ground truth (rendering, never a
// physics input): the cell compresses with strain (exaggerated), the
// weight block appears/sits on the cell when loaded, the chamber
// backdrop shifts with temperature.
import type { GroundTruth } from './api.js'

const VERT = `#version 300 es
precision mediump float;
layout(location=0) in vec3 pos;
layout(location=1) in vec3 nrm;
uniform mat4 mvp;
uniform mat4 model;
out vec3 n;
void main() { n = normalize(mat3(model) * nrm); gl_Position = mvp * vec4(pos, 1.0); }
`
const FRAG = `#version 300 es
precision mediump float;
in vec3 n;
uniform vec3 color;
out vec4 outColor;
void main() {
  float l = 0.55 + 0.45 * max(dot(normalize(n), normalize(vec3(0.4, 0.8, 0.6))), 0.0);
  outColor = vec4(color * l, 1.0);
}
`

function box(w: number, h: number, d: number): Float32Array {
  const x = w / 2, y = h / 2, z = d / 2
  const v: number[] = []
  const face = (a: number[], b: number[], c: number[], d2: number[], n: number[]) => {
    for (const p of [a, b, c, a, c, d2]) v.push(...p, ...n)
  }
  face([-x,-y, z],[ x,-y, z],[ x, y, z],[-x, y, z],[0,0,1])
  face([ x,-y,-z],[-x,-y,-z],[-x, y,-z],[ x, y,-z],[0,0,-1])
  face([-x, y, z],[ x, y, z],[ x, y,-z],[-x, y,-z],[0,1,0])
  face([-x,-y,-z],[ x,-y,-z],[ x,-y, z],[-x,-y, z],[0,-1,0])
  face([ x,-y, z],[ x,-y,-z],[ x, y,-z],[ x, y, z],[1,0,0])
  face([-x,-y,-z],[-x,-y, z],[-x, y, z],[-x, y,-z],[-1,0,0])
  return new Float32Array(v)
}

function mat4Multiply(a: number[], b: number[]): number[] {
  const o = new Array(16).fill(0)
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++)
    for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k]
  return o
}
function perspective(fov: number, aspect: number, near: number, far: number): number[] {
  const f = 1 / Math.tan(fov / 2), nf = 1 / (near - far)
  return [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]
}
function translate(x: number, y: number, z: number): number[] {
  return [1,0,0,0, 0,1,0,0, 0,0,1,0, x,y,z,1]
}
function scaleM(x: number, y: number, z: number): number[] {
  return [x,0,0,0, 0,y,0,0, 0,0,z,0, 0,0,0,1]
}

interface Mesh { buf: WebGLBuffer; count: number; color: [number, number, number] }

export function mountBench(canvas: HTMLCanvasElement): { render: (gt: GroundTruth) => void } | null {
  const gl = canvas.getContext('webgl2')
  if (!gl) return null
  const compile = (type: number, src: string): WebGLShader => {
    const s = gl.createShader(type)!
    gl.shaderSource(s, src); gl.compileShader(s)
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader error')
    return s
  }
  const prog = gl.createProgram()!
  gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT))
  gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG))
  gl.linkProgram(prog)
  gl.useProgram(prog)
  const uMvp = gl.getUniformLocation(prog, 'mvp')
  const uModel = gl.getUniformLocation(prog, 'model')
  const uColor = gl.getUniformLocation(prog, 'color')

  const meshes: Mesh[] = [
    { buf: gl.createBuffer()!, count: 36, color: [0.45, 0.47, 0.52] },  // base plate
    { buf: gl.createBuffer()!, count: 36, color: [0.72, 0.72, 0.75] },  // the cell (column)
    { buf: gl.createBuffer()!, count: 36, color: [0.25, 0.25, 0.28] },  // the weight
  ]
  const geoms = [box(6, 0.4, 4), box(1.6, 2.2, 1.6), box(1.2, 1.2, 1.2)]
  meshes.forEach((m, i) => {
    gl.bindBuffer(gl.ARRAY_BUFFER, m.buf)
    gl.bufferData(gl.ARRAY_BUFFER, geoms[i]!, gl.STATIC_DRAW)
  })
  gl.enableVertexAttribArray(0)
  gl.enableVertexAttribArray(1)
  gl.enable(gl.DEPTH_TEST)

  const proj = perspective(Math.PI / 5, canvas.width / canvas.height, 0.1, 100)
  const view = translate(0, -1.2, -9)
  // simple orbit-less view: slight tilt via two mat4 rotations approximated by translate only (v1)

  function draw(mesh: Mesh, model: number[]): void {
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.buf)
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0)
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 12)
    gl.uniformMatrix4fv(uModel, false, model)
    gl.uniformMatrix4fv(uMvp, false, mat4Multiply(proj, mat4Multiply(view, model)))
    gl.uniform3fv(uColor, mesh.color)
    gl.drawArrays(gl.TRIANGLES, 0, mesh.count)
  }

  return {
    render(gt: GroundTruth) {
      const tempT = Math.min(1, Math.max(0, (gt.environment.temperatureDegC + 10) / 70))
      gl.clearColor(0.75 + tempT * 0.15, 0.82 - tempT * 0.1, 0.9 - tempT * 0.25, 1)
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)
      draw(meshes[0]!, translate(0, -0.2, 0))
      // cell compresses with strain, exaggerated ×400 for visibility
      const squash = Math.max(0.55, 1 - gt.strainMm * 400)
      draw(meshes[1]!, mat4Multiply(translate(0, 1.1 * squash, 0), scaleM(1, squash, 1)))
      if (gt.appliedLoadKg > 0) {
        const w = Math.min(1.6, 0.6 + gt.appliedLoadKg / 500)
        draw(meshes[2]!, mat4Multiply(translate(0, 2.2 * squash + 0.6 * w, 0), scaleM(w, w, w)))
      }
    },
  }
}

export function renderDials(gt: GroundTruth, indication: { value: number; unit: string } | null): void {
  const set = (id: string, text: string) => { const el = document.getElementById(id); if (el) el.textContent = text }
  set('dial-temp', `${gt.environment.temperatureDegC.toFixed(1)} °C`)
  set('dial-rh', `${gt.environment.humidityPercentRh.toFixed(0)} %Rh`)
  set('dial-press', `${gt.environment.pressureKPa.toFixed(1)} kPa`)
  set('dial-clock', `t = ${gt.clockS.toFixed(0)} s`)
  set('indication', indication ? `${indication.value.toFixed(2)} ${indication.unit}` : '— kg')
}
