<!--
  InstrumentChooser.vue — the R 60 catalog picker. Three columns cascade:
  manufacturer → model (class + capacity) → sample (fresh / aged / dropped
  / corroded / lying-twin / ...). Selecting a sample issues `scenario
  <id>` through the console machinery. Triggered from a button in the
  bench pane header that shows the current selection.
-->
<template>
  <div class="chooser-root">
    <button class="trigger" @click="open = !open" aria-haspopup="dialog" :aria-expanded="open">
      <span class="trig-label">instrument</span>
      <span class="trig-value">
        <span class="mfr">{{ currentMfr?.shortName ?? '—' }}</span>
        <span class="sep">·</span>
        <span class="mdl">{{ currentModel?.designation ?? '—' }}</span>
        <span class="badge" v-if="currentModel" :style="{ color: classColor(currentModel.accuracyClass), borderColor: classColor(currentModel.accuracyClass) }">
          {{ currentModel.accuracyClass }}{{ currentModel.classNumber }}
        </span>
        <span class="capacity" v-if="currentModel">{{ formatCapacity(currentModel.eMaxKg) }}</span>
      </span>
      <span class="sample" v-if="currentSample">
        <span class="sample-dot" :style="{ background: damageColor(currentSample.damageKind) }" />
        {{ currentSample.sampleName }}
      </span>
      <span class="caret" aria-hidden="true">▾</span>
    </button>

    <div v-if="open" class="scrim" @click="open = false" />
    <div v-if="open" class="popover" role="dialog" aria-label="Choose an instrument">
      <header class="pop-header">
        <span class="pop-title">R 60 instrument catalog</span>
        <button class="pop-close" @click="open = false" aria-label="Close">×</button>
      </header>
      <div class="columns">
        <div class="column">
          <div class="col-head">manufacturer</div>
          <ul class="col-list">
            <li v-for="mfr in CATALOG" :key="mfr.id">
              <button
                class="col-item"
                :class="{ active: selectedMfrId === mfr.id }"
                @click="selectMfr(mfr.id)"
              >
                <span class="item-main">{{ mfr.shortName }}</span>
                <span class="item-sub">{{ mfr.country }} · {{ mfr.models.length }} model{{ mfr.models.length === 1 ? '' : 's' }}</span>
              </button>
            </li>
          </ul>
        </div>

        <div class="column">
          <div class="col-head">model (class · capacity)</div>
          <ul class="col-list" v-if="selectedMfr">
            <li v-for="mdl in selectedMfr.models" :key="mdl.id">
              <button
                class="col-item"
                :class="{ active: selectedModelId === mdl.id }"
                @click="selectModel(mdl.id)"
              >
                <span class="item-main">{{ mdl.designation }}</span>
                <span class="item-meta">
                  <span class="badge" :style="{ color: classColor(mdl.accuracyClass), borderColor: classColor(mdl.accuracyClass) }">
                    {{ mdl.accuracyClass }}{{ mdl.classNumber }}
                  </span>
                  <span class="meta-text">{{ formatCapacity(mdl.eMaxKg) }} · n_lc {{ mdl.nLc.toLocaleString() }} · {{ mdl.technology.replace('-', ' ') }}</span>
                </span>
              </button>
            </li>
          </ul>
          <div v-else class="col-empty">← pick a manufacturer</div>
        </div>

        <div class="column">
          <div class="col-head">sample (characteristics)</div>
          <ul class="col-list" v-if="selectedModel">
            <li v-for="s in selectedModel.samples" :key="s.id">
              <button
                class="col-item sample-item"
                :class="{ active: currentSample?.id === s.id }"
                @click="chooseSample(s)"
              >
                <span class="sample-row">
                  <span class="sample-dot" :style="{ background: damageColor(s.damageKind) }" />
                  <span class="item-main">{{ s.sampleName }}</span>
                  <span class="serial">{{ s.serialNumber }}</span>
                </span>
                <span class="item-sub">{{ s.description }}</span>
              </button>
            </li>
          </ul>
          <div v-else class="col-empty">← pick a model</div>
        </div>
      </div>
      <footer class="pop-footer">
        <span class="hint">Each sample is a distinct R 60 evaluation subject — fresh, damaged, or twin-fidelity-faulted.</span>
      </footer>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { bench, runCommand } from '../lib/store.js'
import { CATALOG, findInCatalog, classColor, damageColor, type Manufacturer, type Model, type Sample } from '../lib/catalog.js'

const open = ref(false)
const selectedMfrId = ref<string | undefined>(undefined)
const selectedModelId = ref<string | undefined>(undefined)

// Initialise selection from whatever the sim is currently running.
const currentSample = computed(() => findInCatalog(bench.scenario).sample)
const currentModel = computed(() => findInCatalog(bench.scenario).model ?? findInCatalog(bench.scenario).manufacturer?.models[0])
const currentMfr = computed(() => findInCatalog(bench.scenario).manufacturer ?? CATALOG[0])

watch(open, (o) => {
  if (!o) return
  // On open, preselect the columns to the current sample so the user
  // sees where they are before browsing.
  const cur = findInCatalog(bench.scenario)
  selectedMfrId.value = cur.manufacturer?.id ?? CATALOG[0]!.id
  selectedModelId.value = cur.model?.id ?? CATALOG[0]!.models[0]!.id
})

const selectedMfr = computed<Manufacturer | undefined>(() => CATALOG.find(m => m.id === selectedMfrId.value))
const selectedModel = computed<Model | undefined>(() => selectedMfr.value?.models.find(m => m.id === selectedModelId.value))

function selectMfr(id: string): void {
  selectedMfrId.value = id
  selectedModelId.value = CATALOG.find(m => m.id === id)?.models[0]?.id
}
function selectModel(id: string): void { selectedModelId.value = id }
async function chooseSample(s: Sample): Promise<void> {
  open.value = false
  bench.scenario = s.scenarioId
  bench.scenarioDescription = s.description
  await runCommand(`scenario ${s.scenarioId}`, { elevate: true, echo: true })
}

function formatCapacity(kg: number): string {
  if (kg >= 1000) return `${(kg / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 })} t`
  return `${kg} kg`
}
</script>

<style scoped>
.chooser-root { position: relative; }
.trigger {
  display: inline-flex; align-items: center; gap: 0.625rem;
  background: var(--color-surface-2);
  border: 1px solid var(--color-line-strong);
  color: var(--color-fg);
  padding: 0.4rem 0.75rem;
  border-radius: 6px;
  cursor: pointer;
  font-family: var(--font-body); font-size: 0.78rem;
  transition: all 100ms;
}
.trigger:hover { background: var(--color-surface-3); border-color: var(--color-fg-mute); }
.trigger:focus-visible { outline: 2px solid var(--color-twin); outline-offset: 1px; }
.trig-label {
  font-family: var(--font-mono); font-size: 0.6rem;
  letter-spacing: 0.14em; text-transform: uppercase;
  color: var(--color-fg-mute); font-weight: 500;
}
.trig-value { display: inline-flex; align-items: center; gap: 0.4rem; }
.mfr { color: var(--color-fg); font-weight: 600; }
.mdl { color: var(--color-fg); }
.sep { color: var(--color-fg-mute); }
.capacity { color: var(--color-fg-dim); font-family: var(--font-mono); font-size: 0.72rem; }
.sample {
  display: inline-flex; align-items: center; gap: 0.3rem;
  padding: 1px 7px; border-radius: 999px;
  background: var(--color-surface-3); border: 1px solid var(--color-line-strong);
  font-family: var(--font-mono); font-size: 0.7rem; color: var(--color-fg-dim);
}
.sample-dot { width: 6px; height: 6px; border-radius: 50%; display: inline-block; }
.caret { color: var(--color-fg-mute); }

.badge {
  font-family: var(--font-mono); font-size: 0.66rem; font-weight: 600;
  padding: 1px 6px; border: 1px solid; border-radius: 3px;
  letter-spacing: 0.02em;
}

.scrim {
  position: fixed; inset: 0; z-index: 30; background: transparent;
}
.popover {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  width: min(880px, calc(100vw - 2rem));
  background: var(--color-surface-1);
  border: 1px solid var(--color-line-strong);
  border-radius: 10px;
  box-shadow: 0 12px 36px rgba(0,0,0,0.6);
  z-index: 31;
  overflow: hidden;
}
.pop-header {
  display: flex; align-items: center; gap: 0.75rem;
  padding: 0.625rem 0.875rem;
  border-bottom: 1px solid var(--color-line);
  background: var(--color-surface-2);
}
.pop-title {
  font-family: var(--font-display); font-size: 0.82rem; font-weight: 600;
  color: var(--color-fg);
}
.pop-close {
  margin-left: auto;
  background: transparent; border: 1px solid var(--color-line-strong);
  color: var(--color-fg-dim);
  width: 24px; height: 24px; border-radius: 4px;
  font-size: 1rem; cursor: pointer; line-height: 1;
}
.pop-close:hover { color: var(--color-fg); border-color: var(--color-fg-mute); }

.columns {
  display: grid;
  grid-template-columns: 1fr 1.4fr 1.6fr;
  gap: 1px;
  background: var(--color-line);
}
.column { background: var(--color-surface-1); padding: 0.5rem; min-height: 280px; max-height: 60vh; overflow-y: auto; }
.col-head {
  font-family: var(--font-mono); font-size: 0.58rem;
  letter-spacing: 0.16em; text-transform: uppercase;
  color: var(--color-fg-mute); font-weight: 500;
  padding: 0.25rem 0.5rem 0.5rem;
}
.col-list { list-style: none; margin: 0; padding: 0; }
.col-list li { margin-bottom: 4px; }
.col-item {
  width: 100%; text-align: left;
  background: transparent;
  border: 1px solid transparent;
  color: var(--color-fg);
  padding: 0.5rem 0.625rem;
  border-radius: 5px;
  cursor: pointer;
  display: flex; flex-direction: column; gap: 0.2rem;
  font-family: var(--font-body); font-size: 0.8rem;
  transition: background 100ms;
}
.col-item:hover { background: var(--color-surface-2); }
.col-item.active {
  background: var(--color-twin-soft);
  border-color: var(--color-twin-line);
}
.col-item .item-main { color: var(--color-fg); font-weight: 500; }
.col-item .item-sub { color: var(--color-fg-mute); font-size: 0.7rem; line-height: 1.4; }
.col-item .item-meta { display: flex; align-items: center; gap: 0.4rem; flex-wrap: wrap; }
.col-item .item-meta .meta-text { color: var(--color-fg-dim); font-family: var(--font-mono); font-size: 0.66rem; }
.col-item .serial { color: var(--color-fg-mute); font-family: var(--font-mono); font-size: 0.66rem; margin-left: auto; }
.col-item.sample-item.active {
  background: var(--color-world-soft);
  border-color: var(--color-world-line);
}
.sample-row { display: flex; align-items: center; gap: 0.4rem; }
.col-empty {
  padding: 1rem 0.625rem;
  color: var(--color-fg-mute);
  font-size: 0.78rem; font-style: italic;
}

.pop-footer {
  padding: 0.5rem 0.875rem;
  background: var(--color-surface-2);
  border-top: 1px solid var(--color-line);
}
.hint {
  font-size: 0.7rem; color: var(--color-fg-mute);
}
</style>
