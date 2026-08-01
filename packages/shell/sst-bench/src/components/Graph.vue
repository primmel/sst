<!--
  Graph.vue — the live weight trace. Two lines over virtual time:
    · the /world ground-truth load (the actual mass on the pan)
    · the /twin served indication (what the instrument legally reports)
  They diverge under creep, drift, filter lag, and twin infidelity — the
  visible core of the epistemic wall. The chart starts drawing on the
  first poll; users see the zero baseline before they actuate, then the
  indication responding (filter delay, creep tail) when they place a load.

  MPE band: per R 60-1, the maximum permissible error grows with load in
  steps (0.5 v_min → 1.0 → 1.5 → 2.0 across n_lc intervals). We render it
  as a shaded amber corridor around the actual line so a trespass (a
  failing indication) is visible at a glance.
-->
<template>
  <div class="graph-panel">
    <div class="graph-head">
      <div class="titles">
        <span class="title-tag">/twin indication vs /world actual</span>
        <span class="title-sub">live trace · virtual time →</span>
      </div>
      <div class="legend">
        <span class="legend-item"><span class="swatch world" /> actual</span>
        <span class="legend-item"><span class="swatch twin" /> indicated</span>
        <span class="legend-item"><span class="swatch mpe" /> MPE band</span>
        <button class="clear-btn" @click="clear" title="Clear the trace">clear</button>
      </div>
    </div>
    <div class="graph-area">
      <svg :viewBox="`0 0 ${W} ${H}`" preserveAspectRatio="none" class="graph-svg">
        <!-- horizontal gridlines + Y labels -->
        <g>
          <line v-for="(yt, i) in yTicks" :key="'h'+i"
            :x1="pad.l" :x2="W - pad.r"
            :y1="scaleY(yt.value)" :y2="scaleY(yt.value)"
            stroke="var(--color-line-soft)" stroke-width="0.6" />
          <text v-for="(yt, i) in yTicks" :key="'yl'+i"
            :x="pad.l - 6" :y="scaleY(yt.value) + 3"
            text-anchor="end" class="axis-label">{{ yt.label }}</text>
        </g>
        <!-- MPE band: polygon traced along actual ± mpe(actual) -->
        <path v-if="samples.length > 1" :d="mpeBandPath"
          fill="rgba(232, 163, 61, 0.10)"
          stroke="rgba(232, 163, 61, 0.22)" stroke-width="0.5" />
        <!-- actual line -->
        <path v-if="samples.length > 1" :d="actualPath"
          fill="none" stroke="var(--color-world-bright)" stroke-width="1.8" />
        <!-- indicated line -->
        <path v-if="samples.length > 1" :d="indicatedPath"
          fill="none" stroke="var(--color-twin-bright)" stroke-width="1.8" />
        <!-- axes -->
        <line :x1="pad.l" :x2="pad.l" :y1="pad.t" :y2="H - pad.b" stroke="var(--color-line-strong)" />
        <line :x1="pad.l" :x2="W - pad.r" :y1="H - pad.b" :y2="H - pad.b" stroke="var(--color-line-strong)" />
        <!-- X labels (virtual time) -->
        <text v-for="(xt, i) in xTicks" :key="'xl'+i"
          :x="scaleX(xt.value)" :y="H - pad.b + 14"
          text-anchor="middle" class="axis-label">{{ xt.label }}</text>
        <!-- empty-state hint -->
        <text v-if="samples.length < 2" :x="W / 2" :y="H / 2"
          text-anchor="middle" class="empty-hint">place a load and press ▶ to start the trace</text>
      </svg>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { bench } from '../lib/store.js'

interface Sample { t: number; actual: number; indicated: number }

const samples = ref<Sample[]>([])
const MAX_SAMPLES = 800  // ~3 min @ 2 Hz, or longer under slow polling

const W = 720, H = 200
const pad = { l: 44, r: 14, t: 12, b: 22 }

watch(() => bench.groundTruth, (gt) => {
  if (!gt) return
  const indicated = bench.indication?.indication?.value ?? gt.appliedLoadKg
  samples.value.push({ t: gt.clockS, actual: gt.appliedLoadKg, indicated })
  if (samples.value.length > MAX_SAMPLES) samples.value = samples.value.slice(-MAX_SAMPLES)
})

function clear(): void { samples.value = [] }

// ── MPE per R 60-1 (class C approximation; v_min from scenario) ──────
// v_min = E_max / n_lc. For the default good-cell (E_max 500 kg, n_lc 6000)
// v_min ≈ 0.0833 kg. The MPE per R 60-1 5.2.1 grows in steps across the
// n_lc range. We compute it as a piecewise function of the load.
const V_MIN = 500 / 6000   // 0.0833 kg — TODO: pull from scenario when class varies
function mpeAt(loadKg: number): number {
  if (loadKg <= 0) return V_MIN * 0.5
  const intervals = loadKg / V_MIN
  // Class C envelope (R 60-1, Table 3-7):
  //   ≤ 500     : 0.5 v_min
  //   ≤ 2000    : 1.0 v_min
  //   ≤ 4000    : 1.5 v_min
  //   > 4000    : 2.0 v_min (capped; depends on n_lc of class)
  if (intervals <= 500)  return V_MIN * 0.5
  if (intervals <= 2000) return V_MIN * 1.0
  if (intervals <= 4000) return V_MIN * 1.5
  return V_MIN * 2.0
}

// ── Scaling ──────────────────────────────────────────────────────────
const yMax = computed(() => {
  const m = Math.max(50, ...samples.value.map(s => Math.max(Math.abs(s.actual), Math.abs(s.indicated))))
  // round up to a "nice" number
  const mag = Math.pow(10, Math.floor(Math.log10(m)))
  return Math.ceil(m / mag) * mag * 1.05
})

const yTicks = computed(() => {
  const n = 4
  const ticks: Array<{ value: number; label: string }> = []
  for (let i = 0; i <= n; i++) {
    const v = (yMax.value * i) / n
    ticks.push({ value: v, label: formatLoad(v) })
  }
  return ticks
})

const xMin = computed(() => samples.value.length > 0 ? samples.value[0]!.t : 0)
const xMax = computed(() => {
  const t = samples.value.length > 0 ? samples.value[samples.value.length - 1]!.t : 60
  return Math.max(t, xMin.value + 30)
})
const xRange = computed(() => Math.max(1, xMax.value - xMin.value))

const xTicks = computed(() => {
  const n = 5
  const ticks: Array<{ value: number; label: string }> = []
  for (let i = 0; i <= n; i++) {
    const v = xMin.value + (xRange.value * i) / n
    ticks.push({ value: v, label: formatTime(v) })
  }
  return ticks
})

function scaleX(t: number): number {
  return pad.l + ((t - xMin.value) / xRange.value) * (W - pad.l - pad.r)
}
function scaleY(v: number): number {
  return H - pad.b - (v / yMax.value) * (H - pad.t - pad.b)
}

function formatLoad(v: number): string {
  if (v >= 100) return v.toFixed(0)
  if (v >= 10)  return v.toFixed(1)
  return v.toFixed(2)
}
function formatTime(s: number): string {
  if (s < 60)   return `${s.toFixed(0)}s`
  if (s < 3600) return `${Math.floor(s / 60)}m${Math.floor(s % 60).toString().padStart(2, '0')}`
  return `${Math.floor(s / 3600)}h${Math.floor((s % 3600) / 60).toString().padStart(2, '0')}`
}

// ── Path builders ────────────────────────────────────────────────────
const actualPath = computed(() =>
  samples.value.map((s, i) => `${i === 0 ? 'M' : 'L'} ${scaleX(s.t).toFixed(1)} ${scaleY(s.actual).toFixed(1)}`).join(' ')
)
const indicatedPath = computed(() =>
  samples.value.map((s, i) => `${i === 0 ? 'M' : 'L'} ${scaleX(s.t).toFixed(1)} ${scaleY(s.indicated).toFixed(1)}`).join(' ')
)
// MPE band: upper edge left-to-right, lower edge right-to-left
const mpeBandPath = computed(() => {
  if (samples.value.length < 2) return ''
  const upper = samples.value.map((s, i) =>
    `${i === 0 ? 'M' : 'L'} ${scaleX(s.t).toFixed(1)} ${scaleY(s.actual + mpeAt(s.actual)).toFixed(1)}`
  ).join(' ')
  const lower = samples.value.slice().reverse().map(s =>
    `L ${scaleX(s.t).toFixed(1)} ${scaleY(Math.max(0, s.actual - mpeAt(s.actual))).toFixed(1)}`
  ).join(' ')
  return `${upper} ${lower} Z`
})
</script>

<style scoped>
.graph-panel {
  background: var(--color-inset);
  border-top: 1px solid var(--color-line);
  padding: 0.625rem 0.875rem;
  flex-shrink: 0;
}
.graph-head {
  display: flex; align-items: center; gap: 0.875rem;
  margin-bottom: 0.375rem;
}
.titles { display: flex; align-items: baseline; gap: 0.625rem; }
.title-tag {
  font-family: var(--font-mono); font-size: 0.6rem;
  letter-spacing: 0.14em; text-transform: uppercase;
  color: var(--color-fg-dim); font-weight: 500;
}
.title-sub {
  font-family: var(--font-mono); font-size: 0.62rem;
  color: var(--color-fg-mute);
}
.legend { display: flex; align-items: center; gap: 0.875rem; margin-left: auto; }
.legend-item {
  display: inline-flex; align-items: center; gap: 0.3rem;
  font-family: var(--font-mono); font-size: 0.66rem;
  color: var(--color-fg-dim);
}
.swatch { width: 14px; height: 3px; border-radius: 1px; display: inline-block; }
.swatch.world { background: var(--color-world-bright); }
.swatch.twin  { background: var(--color-twin-bright); }
.swatch.mpe   { background: rgba(232, 163, 61, 0.35); height: 8px; }
.clear-btn {
  background: transparent; border: 1px solid var(--color-line-strong);
  color: var(--color-fg-dim); padding: 2px 8px; border-radius: 4px;
  font-family: var(--font-mono); font-size: 0.66rem;
  cursor: pointer;
}
.clear-btn:hover { color: var(--color-fg); border-color: var(--color-fg-mute); }

.graph-area { width: 100%; }
.graph-svg { width: 100%; height: 180px; display: block; }
:deep(.axis-label) {
  fill: var(--color-fg-mute);
  font-family: var(--font-mono); font-size: 9px;
}
:deep(.empty-hint) {
  fill: var(--color-fg-mute);
  font-family: var(--font-mono); font-size: 11px;
  font-style: italic;
}
</style>
