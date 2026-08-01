<!--
  TopBar.vue — instrument identity, channel status pills, and the tour
  / how-it-works toggles. The "Take the tour" CTA pulses on first load
  (until the user dismisses it by clicking), so a newcomer sees the
  clearest entry point without it screaming forever after.
-->
<template>
  <header class="topbar">
    <div class="brand">
      <span class="mark" aria-hidden="true" />
      <span class="name">Primmel SMART Twin Simulator</span>
      <span class="meta">
        <span class="emph">for Load Cells</span>
        <span class="sep">·</span>
        <span>ACME LC-500</span>
        <span class="sep">·</span>
        <span>class C6</span>
        <span class="sep">·</span>
        <span>500 kg</span>
        <span class="sep">·</span>
        <span class="scenario">{{ bench.scenario }}</span>
      </span>
    </div>

    <div class="channels">
      <span class="chan world" title="The physical world — what the operator sees. You drive it.">
        <span class="dot pulse-dot" /> /world <span class="label-sub">reality</span>
      </span>
      <span class="chan twin" title="The instrument's legal view — what a certification engine reads.">
        <span class="dot pulse-dot" /> /twin <span class="label-sub">legal view</span>
      </span>
    </div>

    <div class="actions">
      <button
        class="btn"
        :class="{ active: bench.drawerOpen }"
        @click="toggleDrawer()"
        aria-label="Open the how-it-works drawer"
      >
        <span class="icon">ⓘ</span> How it works
      </button>
      <button
        class="btn primary"
        :class="{ 'cta-pulse': !bench.tourSeen }"
        @click="startTour()"
        aria-label="Start the guided tour"
      >
        <span class="icon">▶</span> Take the tour
      </button>
    </div>
  </header>
</template>

<script setup lang="ts">
import { bench, toggleDrawer, startTour } from '../lib/store.js'
</script>

<style scoped>
.topbar {
  display: flex; align-items: center; gap: 1.5rem;
  padding: 0.75rem 1.5rem;
  background: linear-gradient(180deg, #1F232B 0%, #181C23 100%);
  border-bottom: 1px solid var(--color-line);
  box-shadow: 0 1px 2px rgba(0,0,0,0.4);
  z-index: 10;
  flex-wrap: wrap;
}
.brand { display: flex; align-items: baseline; gap: 0.75rem; min-width: 0; }
.brand .mark {
  width: 10px; height: 10px; border-radius: 2px;
  background: var(--color-twin);
  box-shadow: 0 0 12px rgba(232,163,61,0.25);
  align-self: center; flex-shrink: 0;
}
.brand .name {
  font-family: var(--font-display); font-weight: 600;
  font-size: 0.95rem; letter-spacing: 0.02em; color: var(--color-fg);
  white-space: nowrap;
}
.brand .meta .emph {
  color: var(--color-twin); font-weight: 600;
  text-transform: none; letter-spacing: 0.02em; font-size: 0.78rem;
}
.brand .meta {
  font-family: var(--font-mono); font-size: 0.72rem;
  color: var(--color-fg-dim); letter-spacing: 0.04em;
  text-transform: uppercase; white-space: nowrap;
  overflow: hidden; text-overflow: ellipsis;
}
.brand .meta .sep { color: var(--color-fg-mute); margin: 0 0.5rem; }
.brand .meta .scenario { color: var(--color-warn); }

.channels { display: flex; gap: 0.5rem; margin-left: auto; align-items: center; }
.chan {
  display: inline-flex; align-items: center; gap: 0.5rem;
  padding: 2px 0.75rem; border-radius: 999px;
  font-family: var(--font-mono); font-size: 0.72rem; font-weight: 500;
  letter-spacing: 0.02em; border: 1px solid;
}
.chan .dot { width: 6px; height: 6px; border-radius: 50%; }
.chan .label-sub { color: var(--color-fg-mute); font-size: 0.66rem; }
.chan.twin  { color: var(--color-twin);  border-color: var(--color-twin-line);  background: var(--color-twin-soft); }
.chan.twin  .dot { background: var(--color-twin);  box-shadow: 0 0 6px var(--color-twin); }
.chan.world { color: var(--color-world); border-color: var(--color-world-line); background: var(--color-world-soft); }
.chan.world .dot { background: var(--color-world); box-shadow: 0 0 6px var(--color-world); }

.actions { display: flex; gap: 0.5rem; }
.btn {
  display: inline-flex; align-items: center; gap: 0.5rem;
  padding: 0.5rem 0.75rem; border-radius: 6px;
  border: 1px solid var(--color-line-strong);
  background: var(--color-surface-2);
  color: var(--color-fg);
  font-family: var(--font-body); font-size: 0.82rem; font-weight: 500;
  cursor: pointer;
  transition: background 120ms, border-color 120ms, transform 80ms;
}
.btn:hover { background: var(--color-surface-3); border-color: var(--color-fg-mute); }
.btn:active { transform: translateY(1px); }
.btn:focus-visible { outline: 2px solid var(--color-twin); outline-offset: 1px; }
.btn.active { border-color: var(--color-twin-line); background: var(--color-twin-soft); color: var(--color-twin-bright); }
.btn.primary {
  background: var(--color-twin-soft);
  border-color: var(--color-twin-line);
  color: var(--color-twin-bright);
}
.btn.primary:hover { background: rgba(232, 163, 61, 0.20); border-color: var(--color-twin); }
.btn .icon { font-size: 0.9rem; line-height: 1; }

@media (max-width: 960px) {
  .topbar { padding: 0.5rem 0.75rem; gap: 0.75rem; }
  .channels { order: 3; width: 100%; }
}
</style>
