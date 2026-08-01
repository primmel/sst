<!--
  TimerControls.vue — the virtual clock, made driveable. The console's
  manual clock is the source of truth (deterministic by default); this
  panel adds play/pause + speed (0.5×..10×) so a user can watch physics
  unfold without typing `advance 5m` repeatedly. Implementation: a
  setInterval that periodically calls the `advance <n>s` mutation through
  the console machinery — the log echoes every step, so the user sees the
  grammar they could type themselves.
-->
<template>
  <div class="timer-bar">
    <div class="display">
      <span class="label">virtual clock</span>
      <span class="time">{{ formatTime(currentT) }}</span>
      <span class="mode" :class="{ wall: isWall }">{{ isWall ? 'wall' : 'manual' }}</span>
    </div>
    <div class="controls">
      <button class="btn play" :class="{ active: playing }" @click="toggle" :aria-label="playing ? 'Pause' : 'Play'">
        <span class="icon">{{ playing ? '⏸' : '▶' }}</span>
      </button>
      <button class="btn step" @click="stepOnce" aria-label="Advance one second" title="Advance 1 second">+1s</button>
      <div class="speeds">
        <button v-for="s in speeds" :key="s"
          class="speed-btn" :class="{ active: speed === s && playing }"
          @click="setSpeed(s)"
        >{{ s }}×</button>
      </div>
      <button class="btn reset-time" @click="reset" aria-label="Reset the clock" title="Power-cycle (resets clock too)">⟲</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onBeforeUnmount } from 'vue'
import { bench, runCommand } from '../lib/store.js'

const playing = ref(false)
const speed = ref(1)
const speeds: ReadonlyArray<number> = [0.5, 1, 2, 5, 10]

const currentT = computed(() => bench.groundTruth?.clockS ?? 0)
const isWall = computed(() => false)  // the web UI drives manual mode; wall mode is opt-in via console

let tickHandle: number | undefined
const TICK_MS = 200  // 5 ticks per real second

function tick(): void {
  if (!playing.value) return
  // advance <speed * TICK/1000> seconds per tick — at 1× = real-time
  const seconds = speed.value * (TICK_MS / 1000)
  // the grammar accepts decimals: "advance 0.2s"
  void runCommand(`advance ${seconds}s`, { elevate: true })
}

function toggle(): void {
  playing.value = !playing.value
  if (playing.value) {
    tickHandle = window.setInterval(tick, TICK_MS)
  } else if (tickHandle !== undefined) {
    window.clearInterval(tickHandle)
    tickHandle = undefined
  }
}

function setSpeed(s: number): void {
  speed.value = s
  if (!playing.value) toggle()
}

function stepOnce(): void { void runCommand('advance 1s', { elevate: true }) }
function reset(): void { void runCommand('reset', { elevate: true }) }

function formatTime(s: number): string {
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = Math.floor(s % 60)
  const cs = Math.floor((s % 1) * 100)
  return `${pad(h)}:${pad(m)}:${pad(sec)}.${pad(cs)}`
}
function pad(n: number): string { return n.toString().padStart(2, '0') }

onBeforeUnmount(() => {
  if (tickHandle !== undefined) window.clearInterval(tickHandle)
})
</script>

<style scoped>
.timer-bar {
  display: flex; align-items: center; gap: 1rem;
  padding: 0.5rem 0.875rem;
  background: var(--color-surface-1);
  border-top: 1px solid var(--color-line);
  flex-shrink: 0;
}
.display { display: flex; align-items: baseline; gap: 0.5rem; }
.display .label {
  font-family: var(--font-mono); font-size: 0.58rem;
  letter-spacing: 0.16em; text-transform: uppercase;
  color: var(--color-fg-mute); font-weight: 500;
}
.display .time {
  font-family: var(--font-mono); font-size: 1.2rem; font-weight: 600;
  color: var(--color-fg); font-variant-numeric: tabular-nums;
  letter-spacing: 0.02em;
}
.display .mode {
  font-family: var(--font-mono); font-size: 0.62rem;
  color: var(--color-fg-mute);
  padding: 1px 6px; border: 1px solid var(--color-line-strong);
  border-radius: 3px;
}
.display .mode.wall { color: var(--color-world); border-color: var(--color-world-line); }

.controls { display: flex; align-items: center; gap: 0.5rem; margin-left: auto; }
.btn {
  background: var(--color-surface-2);
  border: 1px solid var(--color-line-strong);
  color: var(--color-fg);
  width: 30px; height: 30px;
  border-radius: 5px;
  font-family: var(--font-mono); font-size: 0.75rem; font-weight: 500;
  cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center;
  transition: all 100ms;
}
.btn:hover { background: var(--color-surface-3); border-color: var(--color-fg-mute); }
.btn:focus-visible { outline: 2px solid var(--color-twin); outline-offset: 1px; }
.btn.play { color: var(--color-twin); border-color: var(--color-twin-line); background: var(--color-twin-soft); }
.btn.play.active { background: var(--color-twin); color: #1A1410; }
.btn.play .icon { font-size: 0.85rem; }
.btn.step { width: auto; padding: 0 0.625rem; }
.btn.reset-time { color: var(--color-fg-dim); }

.speeds { display: flex; gap: 2px; }
.speed-btn {
  background: var(--color-surface-2);
  border: 1px solid var(--color-line-strong);
  color: var(--color-fg-dim);
  height: 30px; min-width: 36px; padding: 0 6px;
  border-radius: 5px;
  font-family: var(--font-mono); font-size: 0.7rem; font-weight: 500;
  cursor: pointer;
  transition: all 100ms;
}
.speed-btn:hover { background: var(--color-surface-3); color: var(--color-fg); }
.speed-btn.active {
  background: var(--color-twin-soft);
  border-color: var(--color-twin-line);
  color: var(--color-twin-bright);
}
</style>
