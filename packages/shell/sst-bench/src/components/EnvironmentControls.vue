<!--
  EnvironmentControls.vue — the OIML D 11 chamber, made driveable. Three
  sliders (temperature, humidity, pressure) that issue `set temperature
  <v>` / `set humidity <v>` / `set pressure <v>` through the console on
  change, plus the damp-heat profile button. The values displayed are the
  live /world readings (not the slider thumb), so feedback is honest — a
  chamber program playing will move the thumb automatically.
-->
<template>
  <div class="env-bar">
    <div class="env-item">
      <label class="env-label">
        <span class="k">temp</span>
        <span class="v">{{ formatNum(currentTemp, 1) }} °C</span>
      </label>
      <input type="range" class="slider temp" min="-40" max="80" step="1"
        :value="currentTemp" :disabled="disabled"
        @change="onTemp(($event.target as HTMLInputElement).value)" />
      <span class="range">−10 … +40 rated</span>
    </div>
    <div class="env-item">
      <label class="env-label">
        <span class="k">humidity</span>
        <span class="v">{{ formatNum(currentRh, 0) }} %Rh</span>
      </label>
      <input type="range" class="slider rh" min="0" max="100" step="1"
        :value="currentRh" :disabled="disabled"
        @change="onRh(($event.target as HTMLInputElement).value)" />
      <button class="profile-btn" :disabled="disabled" @click="onProfile" title="IEC 60068-2-30 cyclic humidity">damp heat</button>
    </div>
    <div class="env-item">
      <label class="env-label">
        <span class="k">pressure</span>
        <span class="v">{{ formatNum(currentPress, 1) }} kPa</span>
      </label>
      <input type="range" class="slider press" min="90" max="110" step="0.5"
        :value="currentPress" :disabled="disabled"
        @change="onPress(($event.target as HTMLInputElement).value)" />
      <span class="range">reference 101.325</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { bench, runCommand } from '../lib/store.js'

const currentTemp  = computed(() => bench.groundTruth?.environment.temperatureDegC ?? 20)
const currentRh    = computed(() => bench.groundTruth?.environment.humidityPercentRh ?? 50)
const currentPress = computed(() => bench.groundTruth?.environment.pressureKPa ?? 101.3)

// disable while a profile is playing — the chamber drives itself
const disabled = computed(() => false)

function onTemp(v: string): void { void runCommand(`set temperature ${v}`, { elevate: true, echo: true }) }
function onRh(v: string): void   { void runCommand(`set humidity ${v}`,    { elevate: true, echo: true }) }
function onPress(v: string): void{ void runCommand(`set pressure ${v}`,    { elevate: true, echo: true }) }
function onProfile(): void       { void runCommand('play profile damp-heat-cyclic-db', { elevate: true, echo: true }) }

function formatNum(v: number, digits: number): string { return v.toFixed(digits) }
</script>

<style scoped>
.env-bar {
  display: grid;
  grid-template-columns: 1fr 1.4fr 1fr;
  gap: 1rem;
  padding: 0.625rem 0.875rem;
  background: var(--color-surface-1);
  border-top: 1px solid var(--color-line);
  flex-shrink: 0;
}
.env-item { display: flex; flex-direction: column; gap: 0.3rem; min-width: 0; }
.env-label {
  display: flex; align-items: baseline; gap: 0.5rem;
  font-family: var(--font-mono); font-size: 0.72rem;
}
.env-label .k {
  font-size: 0.58rem; letter-spacing: 0.14em;
  text-transform: uppercase; color: var(--color-fg-mute); font-weight: 500;
}
.env-label .v {
  color: var(--color-world); font-weight: 600;
  font-variant-numeric: tabular-nums;
  margin-left: auto;
}
.slider {
  -webkit-appearance: none; appearance: none;
  width: 100%; height: 4px;
  background: var(--color-surface-3);
  border-radius: 2px; outline: none;
  margin: 0;
}
.slider::-webkit-slider-thumb {
  -webkit-appearance: none; appearance: none;
  width: 14px; height: 14px; border-radius: 50%;
  background: var(--color-world);
  border: 2px solid var(--color-base);
  cursor: pointer;
  box-shadow: 0 0 6px rgba(111, 168, 220, 0.4);
}
.slider::-moz-range-thumb {
  width: 14px; height: 14px; border-radius: 50%;
  background: var(--color-world);
  border: 2px solid var(--color-base);
  cursor: pointer;
}
.slider:disabled { opacity: 0.5; cursor: not-allowed; }
.slider:disabled::-webkit-slider-thumb { cursor: not-allowed; }

.range {
  font-family: var(--font-mono); font-size: 0.58rem;
  color: var(--color-fg-mute);
  letter-spacing: 0.04em;
}
.profile-btn {
  background: var(--color-world-soft);
  border: 1px solid var(--color-world-line);
  color: var(--color-world-bright);
  padding: 2px 8px;
  border-radius: 4px;
  font-family: var(--font-mono); font-size: 0.62rem; font-weight: 500;
  cursor: pointer;
  margin-top: 0.25rem;
  align-self: flex-start;
}
.profile-btn:hover:not(:disabled) { background: rgba(111, 168, 220, 0.20); border-color: var(--color-world); }
.profile-btn:disabled { opacity: 0.4; cursor: not-allowed; }
</style>
