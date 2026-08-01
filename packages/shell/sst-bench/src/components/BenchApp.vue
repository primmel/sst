<!--
  BenchApp.vue — the root Vue island. Polls both channels on mount and
  holds the layout: TopBar (identity + channel status + tour/how toggles)
  above a split main pane — the BenchScene (/world made visceral) on the
  left, the console column (QuickActions + Console) on the right. The
  HowItWorksDrawer overlays from the right edge when toggled.
-->
<template>
  <div class="app-grid h-screen grid grid-rows-[auto_1fr]">
    <TopBar />
    <main class="relative grid gap-px bg-line-soft overflow-hidden main-grid">
      <div class="epistemic-wall" aria-hidden="true" />
      <div class="epistemic-wall-label" aria-hidden="true">epistemic wall</div>

      <div class="bench-column">
        <BenchScene />
        <Graph />
        <TimerControls />
        <EnvironmentControls />
      </div>

      <section class="flex min-w-0 min-h-0 flex-col overflow-hidden bg-base">
        <header class="pane-header">
          <span class="tag" style="color: var(--color-twin); background: var(--color-twin-soft);">console</span>
          <h2 class="font-display font-semibold">Terminal</h2>
          <span class="sub">type commands, or use the buttons below — both reach the same place</span>
          <button
            class="pane-tour-btn"
            :class="{ active: bench.tour.active }"
            @click="onTourClick"
            aria-label="Start the guided tour"
          >
            <span class="icon">▶</span> Tour
          </button>
        </header>
        <QuickActions />
        <TourRunner />
        <Console />
      </section>
    </main>

    <HowItWorksDrawer />
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'
import TopBar from './TopBar.vue'
import BenchScene from './BenchScene.vue'
import Graph from './Graph.vue'
import TimerControls from './TimerControls.vue'
import EnvironmentControls from './EnvironmentControls.vue'
import QuickActions from './QuickActions.vue'
import TourRunner from './TourRunner.vue'
import Console from './Console.vue'
import HowItWorksDrawer from './HowItWorksDrawer.vue'
import { bench, startTour, endTour } from '../lib/store.js'
import { startPolling } from '../api.js'

let stopPolling: (() => void) | undefined

function onTourClick(): void {
  if (bench.tour.active) endTour()
  else void startTour()
}

onMounted(() => {
  bench.baseUrl = window.location.origin
  stopPolling = startPolling(
    bench.baseUrl,
    500,
    (gt) => { bench.groundTruth = gt },
    (ind) => { bench.indication = ind },
  )
  bench.polling = true
})

onUnmounted(() => {
  stopPolling?.()
  bench.polling = false
})
</script>

<style scoped>
.app-grid { background: var(--color-base); }
.main-grid { grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr); }
.bench-column {
  display: flex; flex-direction: column;
  min-height: 0; min-width: 0;
  background: var(--color-surface-1);
  overflow: hidden;
}
.bench-column > :deep(.pane) { flex: 1; min-height: 0; }
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
.pane-header .sub {
  font-size: 0.72rem; color: var(--color-fg-dim); margin-left: auto;
}
.pane-tour-btn {
  display: inline-flex; align-items: center; gap: 0.35rem;
  padding: 0.3rem 0.7rem; border-radius: 5px;
  border: 1px solid var(--color-twin-line);
  background: var(--color-twin-soft);
  color: var(--color-twin-bright);
  font-family: var(--font-body); font-size: 0.78rem; font-weight: 500;
  cursor: pointer;
  transition: all 120ms;
}
.pane-tour-btn:hover { background: rgba(232, 163, 61, 0.20); border-color: var(--color-twin); }
.pane-tour-btn.active { background: var(--color-twin); color: #1A1410; }
.pane-tour-btn .icon { font-size: 0.7rem; }

@media (max-width: 960px) {
  .main-grid {
    grid-template-columns: 1fr;
    grid-template-rows: minmax(280px, 42vh) 1fr;
  }
  :deep(.epistemic-wall), :deep(.epistemic-wall-label) { display: none; }
}
</style>
