<!--
  TourRunner.vue — the step-by-step tour panel, docked above the console
  log while active. Each step shows its narration + the command it just
  ran, with a clear Next/Skip pair. The console log accumulates the full
  trace (narration + echo + output) so the user can scroll back; this
  panel is the live progress marker.

  Replaces the legacy runTour() (which slept through every step and
  dumped all output at once — the "hangs after tour finishes" symptom).
  The step data (LC500_TOUR) is reused from core; only the driver is new.
-->
<template>
  <div v-if="bench.tour.active" class="tour-runner">
    <div class="tour-head">
      <span class="tour-tag">Guided tour</span>
      <span class="tour-progress">Step {{ bench.tour.step + 1 }} of {{ bench.tour.total }}</span>
      <div class="tour-bar" aria-hidden="true">
        <div class="tour-bar-fill" :style="{ width: progressPct + '%' }" />
      </div>
      <button class="tour-skip" @click="endTour" aria-label="Skip the rest of the tour">Skip</button>
    </div>
    <p class="tour-narration">{{ bench.tour.narration || '…' }}</p>
    <div class="tour-actions">
      <button
        v-if="!isLast"
        class="tour-next"
        @click="onNext"
        aria-label="Run the next tour step"
      >Next step <span class="arrow">→</span></button>
      <button
        v-else
        class="tour-next done"
        @click="endTour"
        aria-label="Finish the tour"
      >Done <span class="arrow">✓</span></button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { bench, nextTourStep, endTour, type TourStep } from '../lib/store.js'
import { LC500_TOUR } from '@primmel/sst-runtime/console/tour'

// The bench is load-cell-shaped; LC500_TOUR is the canonical tour. When
// other console-shipping families land they'll pass their own steps.
const steps: TourStep[] = LC500_TOUR as unknown as TourStep[]

const isLast = computed(() => bench.tour.step >= bench.tour.total - 1)
const progressPct = computed(() => {
  if (bench.tour.total === 0) return 0
  return Math.round(((bench.tour.step + 1) / bench.tour.total) * 100)
})

function onNext(): void { void nextTourStep(steps) }
</script>

<style scoped>
.tour-runner {
  background: linear-gradient(180deg, rgba(232, 163, 61, 0.10), rgba(232, 163, 61, 0.04));
  border-bottom: 1px solid var(--color-twin-line);
  padding: 0.875rem 1rem;
  flex-shrink: 0;
}
.tour-head {
  display: flex; align-items: center; gap: 0.75rem;
  margin-bottom: 0.5rem;
}
.tour-tag {
  font-family: var(--font-mono); font-size: 0.6rem;
  letter-spacing: 0.18em; text-transform: uppercase;
  color: var(--color-twin); font-weight: 600;
  padding: 2px 8px; background: var(--color-twin-soft);
  border: 1px solid var(--color-twin-line);
  border-radius: 3px;
}
.tour-progress {
  font-family: var(--font-mono); font-size: 0.7rem;
  color: var(--color-fg-dim); font-variant-numeric: tabular-nums;
}
.tour-bar {
  flex: 1; height: 3px;
  background: var(--color-surface-3);
  border-radius: 2px; overflow: hidden;
}
.tour-bar-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--color-twin), var(--color-twin-bright));
  transition: width 320ms var(--ease-drawer);
}
.tour-skip {
  background: transparent;
  border: 1px solid var(--color-line-strong);
  color: var(--color-fg-dim);
  padding: 4px 10px; border-radius: 4px;
  font-family: var(--font-body); font-size: 0.74rem;
  cursor: pointer;
}
.tour-skip:hover { color: var(--color-fg); border-color: var(--color-fg-mute); }

.tour-narration {
  margin: 0 0 0.875rem;
  font-family: var(--font-body);
  font-size: 0.86rem; line-height: 1.6;
  color: var(--color-fg);
}

.tour-actions { display: flex; justify-content: flex-end; }
.tour-next {
  display: inline-flex; align-items: center; gap: 0.5rem;
  background: var(--color-twin); color: #1A1410;
  border: 0; padding: 0.5rem 1rem;
  border-radius: 6px;
  font-family: var(--font-body); font-size: 0.85rem; font-weight: 600;
  cursor: pointer;
  transition: background 120ms, transform 80ms;
}
.tour-next:hover { background: var(--color-twin-bright); }
.tour-next:active { transform: translateY(1px); }
.tour-next:focus-visible { outline: 2px solid var(--color-fg); outline-offset: 2px; }
.tour-next .arrow { font-weight: 700; }
.tour-next.done { background: var(--color-ok); color: #0F1A08; }
.tour-next.done:hover { filter: brightness(1.1); }
</style>
