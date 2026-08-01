<!--
  DialInset.vue — the paired analogue-passive indicator (spec §14). A
  passive indicator has no twin interface: the dial is a RENDERING of
  reality, never a served value — the reading enters evidence through a
  human observer. The dial spec is declared once in @primmel/sst-runtime
  (LC500_PAIRED_DIAL) and consumed by the model and this renderer.
-->
<template>
  <div class="dial-inset" id="pane-dial">
    <div class="caption">
      <span class="tag">/world</span>
      <span class="title">Paired dial</span>
    </div>
    <div ref="scaleRef" class="scale" />
    <p class="note">A passive indicator — no twin interface. You read the needle; the API never serves it.</p>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted } from 'vue'
import { mountDial, type DialPane } from '../dial.js'
import { LC500_PAIRED_DIAL } from '@primmel/sst-runtime/instrument'
import { bench } from '../lib/store.js'

const scaleRef = ref<HTMLDivElement | null>(null)
let pane: DialPane | undefined

onMounted(() => {
  if (scaleRef.value) pane = mountDial(scaleRef.value, LC500_PAIRED_DIAL)
})

watch(() => bench.groundTruth, (gt) => {
  if (gt && pane) pane.render(gt.appliedLoadKg)
})
</script>

<style scoped>
.dial-inset {
  position: absolute;
  bottom: 1rem; right: 1rem;
  width: 188px;
  background: rgba(20, 23, 28, 0.88);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  border: 1px solid var(--color-world-line);
  border-radius: 10px;
  padding: 0.75rem;
  z-index: 3;
  box-shadow: 0 6px 18px rgba(0,0,0,0.5);
}
.caption { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.5rem; }
.caption .tag {
  font-family: var(--font-mono); font-size: 0.58rem;
  letter-spacing: 0.16em; text-transform: uppercase;
  color: var(--color-world); font-weight: 500;
}
.caption .title {
  font-family: var(--font-body); font-size: 0.72rem;
  color: var(--color-fg); font-weight: 500;
}
.scale { display: flex; justify-content: center; }
.scale :deep(svg) { width: 100%; max-width: 160px; height: auto; }
.scale :deep(.tick) { stroke: var(--color-fg-dim); }
.scale :deep(.tick.major) { stroke: var(--color-fg); }
.scale :deep(.dial-num) { fill: var(--color-fg) !important; }
.scale :deep(.dial-caption) { fill: var(--color-fg-mute) !important; }
.note {
  margin: 0.5rem 0 0;
  font-size: 0.66rem; line-height: 1.4;
  color: var(--color-fg-dim); text-align: center;
}
</style>
