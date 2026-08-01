<!--
  QuickActions.vue — the button toolbar above the console. The grammar
  is the canonical surface; these buttons are a friction-free alternative.
  Clicking one feeds the mapped command through the SAME console
  machinery (the log echoes it), so the grammar is taught by observation.
-->
<template>
  <div class="quick-actions">
    <div v-for="g in groups" :key="g.title" class="qa-group">
      <div class="qa-label">{{ g.title }}</div>
      <div class="qa-row">
        <button
          v-for="a in g.actions"
          :key="a.label"
          class="qa-btn"
          :class="a.variant"
          :title="a.hint"
          @click="click(a)"
        >{{ a.label }}</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { runCommand } from '../lib/store.js'

interface QA { label: string; command: string; hint: string; variant: 'world' | 'twin' | 'warn' | 'danger' | 'default' }
interface QAG { title: string; actions: QA[] }

const groups: QAG[] = [
  {
    title: 'Load',
    actions: [
      { label: 'Place 40 kg',  command: 'place load 40',   hint: 'A typical R 60 test load — about 8 % of capacity.',           variant: 'world' },
      { label: 'Place 200 kg', command: 'place load 200',  hint: 'About 40 % of capacity — mid-range repeatability point.',     variant: 'world' },
      { label: 'Remove load',  command: 'remove load',     hint: 'Clear the pan. Watch the creep recovery and hysteresis.',     variant: 'world' },
    ],
  },
  {
    title: 'Environment (OIML D 11)',
    actions: [
      { label: '20 °C',    command: 'set temperature 20',  hint: 'Reference temperature — the rated operating point.',          variant: 'world' },
      { label: '60 °C',    command: 'set temperature 60',  hint: 'Hot extreme — drives the temperature coefficients.',          variant: 'world' },
      { label: '−10 °C',   command: 'set temperature -10', hint: 'Cold extreme — lower end of the rated range.',                variant: 'world' },
      { label: 'Damp heat', command: 'play profile damp-heat-cyclic-db', hint: 'The IEC 60068-2-30 cyclic humidity profile.', variant: 'world' },
    ],
  },
  {
    title: 'Time',
    actions: [
      { label: '+5 min',  command: 'advance 5m',  hint: 'A short virtual dwell — the filter and creep settle.',         variant: 'world' },
      { label: '+30 min', command: 'advance 30m', hint: 'The R 60 creep-test window — watch drift accumulate.',       variant: 'world' },
    ],
  },
  {
    title: 'Scenarios — swap the instrument',
    actions: [
      { label: 'good-cell',   command: 'scenario good-cell',   hint: 'All coefficients inside R 60 limits — passes the test program.', variant: 'warn' },
      { label: 'creep-cell',  command: 'scenario creep-cell',  hint: 'Excessive creep coefficient — fails the 30-min creep test.',     variant: 'warn' },
      { label: 'lying-twin',  command: 'scenario lying-twin',  hint: 'Honest physics, dishonest twin — a certification must catch it.', variant: 'warn' },
    ],
  },
  {
    title: 'Console',
    actions: [
      { label: 'Show indication',   command: 'show indication',    hint: 'Read /twin — what the instrument legally says right now.',  variant: 'twin' },
      { label: 'Show ground truth', command: 'show ground-truth',  hint: 'Read /world — reality, what the operator set.',            variant: 'world' },
      { label: 'Help',  command: 'help',  hint: 'List every console command.',                          variant: 'default' },
      { label: 'Tour',  command: 'tour',  hint: 'The narrated first run — the two channels in action.', variant: 'default' },
      { label: 'Reset', command: 'reset', hint: 'Power-cycle the simulated instrument.',                variant: 'danger' },
    ],
  },
]

function click(a: QA): void {
  // privileged commands (place/remove/set/advance/scenario/reset/play)
  // are auto-elevated: a GUI button is implicit consent. The teaching
  // moment ("you can also type `enable` first") is in the grammar, not
  // in button friction.
  const elevate = a.command !== 'help' && a.command !== 'tour' && !a.command.startsWith('show ')
  void runCommand(a.command, { echo: true, elevate })
}
</script>

<style scoped>
.quick-actions {
  padding: 0.75rem 1rem;
  border-bottom: 1px solid var(--color-line);
  background: var(--color-surface-1);
  flex-shrink: 0;
  overflow-y: auto;
}
.qa-group { display: flex; flex-direction: column; gap: 0.5rem; margin-bottom: 0.75rem; }
.qa-group:last-child { margin-bottom: 0; }
.qa-label {
  font-family: var(--font-mono); font-size: 0.6rem;
  letter-spacing: 0.16em; text-transform: uppercase;
  color: var(--color-fg-mute); font-weight: 500;
}
.qa-row { display: flex; flex-wrap: wrap; gap: 0.5rem; }
.qa-btn {
  display: inline-flex; align-items: center; gap: 0.25rem;
  padding: 0.25rem 0.75rem; border-radius: 6px;
  border: 1px solid var(--color-line-strong);
  background: var(--color-surface-2);
  color: var(--color-fg);
  font-family: var(--font-mono); font-size: 0.74rem; font-weight: 500;
  cursor: pointer; position: relative;
  transition: all 100ms;
}
.qa-btn:hover { background: var(--color-surface-3); border-color: var(--color-fg-mute); transform: translateY(-1px); }
.qa-btn:active { transform: translateY(0); }
.qa-btn:focus-visible { outline: 2px solid var(--color-twin); outline-offset: 1px; }
.qa-btn.world:hover  { border-color: var(--color-world); color: var(--color-world-bright); }
.qa-btn.twin:hover   { border-color: var(--color-twin);  color: var(--color-twin-bright); }
.qa-btn.warn:hover   { border-color: var(--color-warn);  color: var(--color-warn); }
.qa-btn.danger:hover { border-color: var(--color-err);   color: var(--color-err); }
</style>
