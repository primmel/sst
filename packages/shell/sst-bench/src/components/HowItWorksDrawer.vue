<!--
  HowItWorksDrawer.vue — the teaching content, off-canvas. "How it
  works" is instructive reference, not primary chrome — it must NOT
  block screen estate by default. Toggle open from the TopBar; slides
  in from the right with a scrim behind. The signal chain, current
  coefficients, and the constitutive laws render here, fed by the
  latest /world ground truth.
-->
<template>
  <div>
    <div class="scrim" :class="{ visible: bench.drawerOpen }" @click="closeDrawer" />
    <aside class="drawer" :class="{ visible: bench.drawerOpen }" aria-hidden="!bench.drawerOpen">
      <header class="drawer-header">
        <h2>How it works</h2>
        <span class="sub">the live signal chain</span>
        <button class="close" @click="closeDrawer" aria-label="Close drawer">×</button>
      </header>
      <div class="drawer-body scroll-pretty">
        <p>
          The indication you see on
          <span class="hl-twin">/twin</span> is computed from this physical state
          (visible only on <span class="hl-world">/world</span>) through the stages
          below. A certification engine can only see the twin side — comparing the
          two is what testing IS.
        </p>

        <h3>The signal chain</h3>
        <div class="stage-chain">
          <div class="stage"><span class="n">1</span><span class="name">Mechanical</span><span class="desc">elastic element · strain · hysteresis · creep</span></div>
          <div class="stage"><span class="n">2</span><span class="name">Transduction</span><span class="desc">strain-gauge bridge · gauge factor</span></div>
          <div class="stage"><span class="n">3</span><span class="name">Conditioning</span><span class="desc">ADC · filter · linearization · compensation</span></div>
        </div>

        <h3>Live state (from /world)</h3>
        <table>
          <tbody>
            <tr><th>Applied load</th><td>{{ fmt(gt?.appliedLoadKg, ' kg') }}</td></tr>
            <tr><th>Elastic strain</th><td>{{ gt?.strainMm?.toExponential(3) ?? '—' }}</td></tr>
            <tr><th>Span drift accrued</th><td>{{ gt ? (gt.spanDriftFraction * 100).toFixed(4) + ' %' : '—' }}</td></tr>
            <tr><th>Environment</th><td>{{ env }}</td></tr>
            <tr><th>Virtual clock</th><td>{{ gt ? gt.clockS.toFixed(0) + ' s' : '—' }}</td></tr>
          </tbody>
        </table>

        <h3>Current coefficients (the bench knobs)</h3>
        <table>
          <tbody>
            <tr v-for="(v, k) in COEFFS" :key="k"><td>{{ k }}</td><td>{{ v }}</td></tr>
          </tbody>
        </table>

        <h3>The constitutive laws (why no 3D model — design §4.5)</h3>
        <table>
          <tbody>
            <tr v-for="law in LAWS" :key="law[0]"><td>{{ law[0] }}</td><td class="law">{{ law[1] }}</td></tr>
          </tbody>
        </table>
      </div>
    </aside>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { bench, closeDrawer } from '../lib/store.js'

const gt = computed(() => bench.groundTruth)
const env = computed(() => {
  if (!gt.value) return '—'
  const e = gt.value.environment
  return `${e.temperatureDegC.toFixed(1)} °C · ${e.humidityPercentRh.toFixed(0)} %Rh · ${e.pressureKPa.toFixed(1)} kPa`
})
function fmt(v: number | undefined, unit: string): string { return v == null ? '—' : v.toFixed(2) + unit }

const COEFFS: Record<string, string> = {
  compliance: '2.0e-6 mm/kg',
  creepCoefficient: '3.0e-4 (good-cell)',
  creepTauS: '300 s',
  tcZero: '1.0e-4 /°C',
  tcSpan: '2.0e-4 /°C',
  scaleInterval: '0.05 kg',
  filterTau: '1.0 s',
  warmUpTau: '60 s',
}
const LAWS: Array<[string, string]> = [
  ['Elastic response', 'ε = F / E·A_eff (compliance constant — datasheet rated deflection)'],
  ['Hysteresis', 'loading and unloading branches differ (branch memory)'],
  ['Creep', 'ε(t) = ε₀·(1 + c·(1 − e^(−t/τ))) — exponential approach, recovery on unload'],
  ['Temperature', 'zero and span shift linearly: T_C0·ΔT, T_Cspan·ΔT (R 60-1 bounds)'],
  ['Barometric', 'dead-load offset per kPa (R 60-1, 5.6.2)'],
  ['Bridge', 'mV/V = sensitivity × strain (Wheatstone, gauge factor constant)'],
  ['ADC + firmware', 'quantization to d, IIR filter, linearization, compensation residual'],
  ['Drift', 'slow multiplicative span drift (span-stability, days)'],
]
</script>

<style scoped>
.scrim {
  position: fixed; inset: 0;
  background: rgba(0, 0, 0, 0.5);
  opacity: 0; pointer-events: none;
  transition: opacity 200ms;
  z-index: 20;
}
.scrim.visible { opacity: 1; pointer-events: auto; }

.drawer {
  position: fixed;
  top: 0; right: 0; bottom: 0;
  width: min(520px, 92vw);
  background: var(--color-surface-1);
  border-left: 1px solid var(--color-line-strong);
  box-shadow: 0 6px 18px rgba(0,0,0,0.5);
  transform: translateX(100%);
  transition: transform 240ms var(--ease-drawer);
  z-index: 21;
  display: flex; flex-direction: column;
}
.drawer.visible { transform: translateX(0); }

.drawer-header {
  display: flex; align-items: center; gap: 0.75rem;
  padding: 1rem 1.5rem;
  border-bottom: 1px solid var(--color-line);
  flex-shrink: 0;
}
.drawer-header h2 {
  margin: 0; font-family: var(--font-display);
  font-size: 0.95rem; font-weight: 600; color: var(--color-fg);
}
.drawer-header .sub {
  font-size: 0.74rem; color: var(--color-fg-dim);
  margin-left: auto; margin-right: 0.75rem;
}
.drawer-close, .close {
  background: transparent;
  border: 1px solid var(--color-line-strong);
  color: var(--color-fg-dim);
  width: 28px; height: 28px; border-radius: 6px;
  cursor: pointer; font-size: 1rem; line-height: 1;
  display: flex; align-items: center; justify-content: center;
}
.close:hover { color: var(--color-fg); border-color: var(--color-fg-mute); }

.drawer-body { flex: 1; overflow-y: auto; padding: 1.5rem; }
.drawer-body p {
  color: var(--color-fg-dim); font-size: 0.85rem; line-height: 1.6;
  margin: 0 0 1rem;
}
.drawer-body p .hl-twin  { color: var(--color-twin);  font-weight: 600; }
.drawer-body p .hl-world { color: var(--color-world); font-weight: 600; }
.drawer-body h3 {
  font-family: var(--font-display);
  font-size: 0.78rem; font-weight: 600;
  letter-spacing: 0.06em; text-transform: uppercase;
  color: var(--color-fg);
  margin: 1.5rem 0 0.75rem;
  padding-bottom: 0.5rem;
  border-bottom: 1px solid var(--color-line);
}
.drawer-body h3:first-of-type { margin-top: 0; }
.drawer-body table {
  width: 100%; border-collapse: collapse;
  font-family: var(--font-mono); font-size: 0.76rem;
  font-variant-numeric: tabular-nums;
}
.drawer-body th, .drawer-body td {
  text-align: left; padding: 0.5rem 0.75rem;
  border-bottom: 1px solid var(--color-line-soft);
  vertical-align: top;
}
.drawer-body th {
  color: var(--color-fg-mute); font-weight: 500;
  letter-spacing: 0.06em; text-transform: uppercase;
  font-size: 0.66rem; width: 50%;
}
.drawer-body td { color: var(--color-fg); }
.drawer-body td.law { color: var(--color-fg-dim); font-style: italic; }

.stage-chain { display: flex; flex-direction: column; gap: 0.5rem; margin: 0.75rem 0 1rem; }
.stage {
  display: flex; align-items: center; gap: 0.75rem;
  padding: 0.5rem 0.75rem;
  background: var(--color-surface-2);
  border: 1px solid var(--color-line);
  border-radius: 6px;
  font-family: var(--font-mono); font-size: 0.74rem;
}
.stage .n { color: var(--color-twin); font-weight: 600; width: 18px; flex-shrink: 0; }
.stage .name { color: var(--color-fg); font-weight: 500; }
.stage .desc { color: var(--color-fg-mute); margin-left: auto; font-size: 0.7rem; }
</style>
