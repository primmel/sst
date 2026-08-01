<!--
  BenchScene.vue — the /world side made visceral. A stylized WebGL2 scene
  fed exclusively by /world ground truth (rendering, never a physics
  input): the cell compresses with strain (exaggerated), the calibration
  mass appears on the pan when loaded, the chamber tint shifts with
  temperature. The HUD overlay reads /world for environment + clock + load;
  the indication card reads /twin for the served value — both visible in
  the same eye-frame so the epistemic split is felt, not described.
-->
<template>
  <section class="bench-pane pane">
    <header class="pane-header">
      <span class="tag" style="color: var(--color-world); background: var(--color-world-soft);">/world</span>
      <h2 class="font-display font-semibold">The bench</h2>
      <span class="sub">a controlled physical world — you set the ground truth</span>
      <InstrumentChooser />
    </header>
    <div class="bench-stage">
      <canvas ref="canvasRef" width="1280" height="720" class="bench-canvas" />

      <div class="hud" aria-label="environment and clock">
        <div class="hud-row">
          <div class="hud-cell world"><span class="k">temp</span><span class="v">{{ tempC }}</span></div>
          <div class="hud-cell world"><span class="k">rh</span><span class="v">{{ rh }}</span></div>
          <div class="hud-cell world"><span class="k">press</span><span class="v">{{ press }}</span></div>
        </div>
        <div class="hud-row">
          <div class="hud-cell world"><span class="k">clock</span><span class="v">{{ clock }}</span></div>
          <div class="hud-cell world"><span class="k">load</span><span class="v">{{ load }}</span></div>
        </div>
      </div>

      <div class="indication-card" aria-label="indication from /twin">
        <div class="label">
          <span class="top">/twin · indication</span>
          <span class="bottom">the instrument's legal answer</span>
        </div>
        <div class="reading">
          <span class="value">{{ indicationValue }}</span>
          <span class="unit">{{ indicationUnit }}</span>
        </div>
      </div>

      <DialInset />
    </div>
  </section>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import DialInset from './DialInset.vue'
import InstrumentChooser from './InstrumentChooser.vue'
import { bench } from '../lib/store.js'
import type { GroundTruth } from '../api.js'

const canvasRef = ref<HTMLCanvasElement | null>(null)
let scene: { render: (gt: GroundTruth) => void } | null = null

const tempC  = computed(() => bench.groundTruth ? `${bench.groundTruth.environment.temperatureDegC.toFixed(1)} °C` : '—')
const rh     = computed(() => bench.groundTruth ? `${bench.groundTruth.environment.humidityPercentRh.toFixed(0)} %` : '—')
const press  = computed(() => bench.groundTruth ? `${bench.groundTruth.environment.pressureKPa.toFixed(1)} kPa` : '—')
const clock  = computed(() => bench.groundTruth ? `t = ${bench.groundTruth.clockS.toFixed(0)} s` : '—')
const load   = computed(() => bench.groundTruth ? `${bench.groundTruth.appliedLoadKg.toFixed(2)} kg` : '—')
const indicationValue = computed(() => bench.indication ? bench.indication.indication.value.toFixed(2) : '—')
const indicationUnit  = computed(() => bench.indication ? bench.indication.indication.unit : 'kg')

onMounted(() => {
  if (canvasRef.value) scene = mountBenchScene(canvasRef.value)
})
onBeforeUnmount(() => { scene = null })
watch(() => bench.groundTruth, (gt) => { if (gt && scene) scene.render(gt) })

// ── Inline WebGL2 scene (dark instrument-panel palette) ──────────
const VERT = `#version 300 es
precision mediump float;
layout(location=0) in vec3 pos;
layout(location=1) in vec3 nrm;
uniform mat4 mvp;
uniform mat4 model;
out vec3 n;
void main() {
  n = normalize(mat3(model) * nrm);
  gl_Position = mvp * vec4(pos, 1.0);
}`
const FRAG = `#version 300 es
precision mediump float;
in vec3 n;
uniform vec3 color;
uniform vec3 lightDir1;
uniform vec3 lightDir2;
out vec4 outColor;
void main() {
  vec3 nrm = normalize(n);
  float key  = max(dot(nrm, normalize(lightDir1)), 0.0);
  float fill = max(dot(nrm, normalize(lightDir2)), 0.0);
  float lighting = 0.30 + key * 0.60 + fill * 0.20;
  outColor = vec4(color * lighting, 1.0);
}`

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

function cylinder(r: number, h: number, segments = 32): Float32Array {
  const v: number[] = []
  for (let i = 0; i < segments; i++) {
    const a1 = (i / segments) * Math.PI * 2
    const a2 = ((i + 1) / segments) * Math.PI * 2
    const x1 = Math.cos(a1) * r, z1 = Math.sin(a1) * r
    const x2 = Math.cos(a2) * r, z2 = Math.sin(a2) * r
    const nx = (Math.cos(a1) + Math.cos(a2)) / 2, nz = (Math.sin(a1) + Math.sin(a2)) / 2
    v.push(x1,-h/2,z1, nx,0,nz,  x2,-h/2,z2, nx,0,nz,  x1, h/2,z1, nx,0,nz)
    v.push(x2,-h/2,z2, nx,0,nz,  x2, h/2,z2, nx,0,nz,  x1, h/2,z1, nx,0,nz)
    v.push(0, h/2, 0, 0,1,0,  x2, h/2, z2, 0,1,0,  x1, h/2, z1, 0,1,0)
    v.push(0,-h/2, 0, 0,-1,0,  x1,-h/2, z1, 0,-1,0,  x2,-h/2, z2, 0,-1,0)
  }
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

function mountBenchScene(canvas: HTMLCanvasElement): { render: (gt: GroundTruth) => void } | null {
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
  gl.linkProgram(prog); gl.useProgram(prog)
  const uMvp = gl.getUniformLocation(prog, 'mvp')
  const uModel = gl.getUniformLocation(prog, 'model')
  const uColor = gl.getUniformLocation(prog, 'color')
  const uLight1 = gl.getUniformLocation(prog, 'lightDir1')
  const uLight2 = gl.getUniformLocation(prog, 'lightDir2')

  const mkMesh = (data: Float32Array, count: number, color: [number, number, number]): Mesh => {
    const buf = gl.createBuffer()!
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW)
    return { buf, count, color }
  }
  const meshes: Mesh[] = [
    mkMesh(box(6, 0.4, 4), 36, [0.22, 0.23, 0.27]),         // base plate (dark metallic)
    mkMesh(box(1.6, 2.2, 1.6), 36, [0.50, 0.52, 0.58]),     // the cell (medium metallic)
    mkMesh(cylinder(0.7, 1.2, 32), 32 * 6, [0.82, 0.66, 0.32]),  // calibration mass (brass)
  ]
  gl.enableVertexAttribArray(0)
  gl.enableVertexAttribArray(1)
  gl.enable(gl.DEPTH_TEST)

  const proj = perspective(Math.PI / 5, canvas.width / canvas.height, 0.1, 100)
  const view = translate(0, -1.2, -9)
  gl.uniform3fv(uLight1, [0.4, 0.8, 0.6])
  gl.uniform3fv(uLight2, [-0.5, 0.3, -0.4])

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
      gl.clearColor(0.05 + tempT * 0.05, 0.07, 0.10 - tempT * 0.04, 1)
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)
      draw(meshes[0]!, translate(0, -0.2, 0))
      const squash = Math.max(0.55, 1 - gt.strainMm * 400)
      draw(meshes[1]!, mat4Multiply(translate(0, 1.1 * squash, 0), scaleM(1, squash, 1)))
      if (gt.appliedLoadKg > 0) {
        const w = Math.min(1.5, 0.5 + gt.appliedLoadKg / 500)
        draw(meshes[2]!, mat4Multiply(translate(0, 2.2 * squash + 0.6 * w, 0), scaleM(w, w, w)))
      }
    },
  }
}
</script>

<style scoped>
.pane {
  background: var(--color-surface-1);
  display: flex; flex-direction: column;
  min-width: 0; min-height: 0;
  overflow: hidden; position: relative;
}
.pane-header {
  display: flex; align-items: center; gap: 0.75rem;
  padding: 0.75rem 1rem;
  border-bottom: 1px solid var(--color-line);
  flex-shrink: 0;
}
.pane-header h2 { margin: 0; font-size: 0.82rem; letter-spacing: 0.01em; }
.pane-header .tag {
  font-family: var(--font-mono); font-size: 0.62rem; font-weight: 500;
  letter-spacing: 0.18em; text-transform: uppercase;
  padding: 2px 8px; border-radius: 3px;
}
.pane-header .sub { font-size: 0.72rem; color: var(--color-fg-dim); margin-left: auto; }
.pane-header :deep(.chooser-root) { margin-left: 0.5rem; }

.bench-stage {
  position: relative;
  flex: 1; min-height: 0;
  background:
    radial-gradient(ellipse at 50% 30%, rgba(111, 168, 220, 0.06), transparent 60%),
    var(--color-inset);
  overflow: hidden;
}
.bench-canvas { display: block; width: 100%; height: 100%; }

.hud {
  position: absolute; top: 1rem; left: 1rem;
  display: flex; flex-direction: column; gap: 0.5rem;
  pointer-events: none; z-index: 2;
}
.hud-row { display: flex; gap: 0.5rem; flex-wrap: wrap; }
.hud-cell {
  background: rgba(20, 23, 28, 0.78);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  border: 1px solid var(--color-line);
  border-radius: 6px;
  padding: 0.5rem 0.75rem;
  font-family: var(--font-mono);
  font-size: 0.75rem;
  font-variant-numeric: tabular-nums;
  color: var(--color-fg);
  display: flex; align-items: baseline; gap: 0.5rem;
}
.hud-cell.world { border-color: var(--color-world-line); }
.hud-cell .k {
  font-size: 0.6rem; letter-spacing: 0.14em;
  text-transform: uppercase; color: var(--color-fg-mute); font-weight: 500;
}
.hud-cell .v { color: var(--color-fg); }

.indication-card {
  position: absolute;
  bottom: 1rem; left: 1rem;
  right: 13rem;  /* leaves room for the dial inset on the right */
  background: rgba(20, 23, 28, 0.85);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  border: 1px solid var(--color-twin-line);
  border-radius: 10px;
  padding: 0.75rem 1rem;
  display: flex; align-items: center; gap: 1rem;
  pointer-events: none; z-index: 2;
  box-shadow: 0 6px 18px rgba(0,0,0,0.5);
}
.indication-card .label { display: flex; flex-direction: column; gap: 2px; }
.indication-card .label .top {
  font-family: var(--font-mono); font-size: 0.62rem;
  letter-spacing: 0.16em; text-transform: uppercase;
  color: var(--color-twin); font-weight: 500;
}
.indication-card .label .bottom { font-size: 0.7rem; color: var(--color-fg-dim); }
.indication-card .reading {
  margin-left: auto;
  font-family: var(--font-display);
  font-size: 2.2rem; font-weight: 700;
  color: var(--color-twin-bright);
  font-variant-numeric: tabular-nums;
  line-height: 1; letter-spacing: -0.01em;
}
.indication-card .reading .unit {
  font-size: 1rem; color: var(--color-fg-dim);
  font-weight: 500; margin-left: 0.5rem;
}

@media (max-width: 960px) {
  .indication-card { right: 1rem; }
  .indication-card .reading { font-size: 1.6rem; }
}
</style>
