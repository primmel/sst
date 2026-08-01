<!--
  Console.vue — the terminal pane, redesigned. The §7 grammar executed
  against the channels (show indication reads /twin; everything actuating
  reads /world — the console teaches the epistemic split). New surface:
    · Tab autocomplete against the grammar (popover + cycling)
    · Up/Down command history (sessionStorage)
    · PgUp/PgDn log scroll
    · A custom blinking block cursor (Canvas2D-positioned)
    · Smart auto-scroll that holds position when the user scrolls up
    · Ctrl+L clears the log
    · runCommand exposed via the store — quick-actions and the tour
      button feed the same machinery; the log echoes every command.
-->
<template>
  <div class="console-body">
    <div ref="logRef" class="console-log scroll-pretty" tabindex="0" @click="focusInput">
      <div class="line welcome">
        <div class="welcome-title">
          sim-instruments · <span class="hl">ACME LC-500</span> <span class="mute">(simulated)</span>
        </div>
        <div class="welcome-body">A load cell on a controlled bench. Two channels face you:</div>
        <div class="welcome-channels">
          <span class="hl-twin">/twin</span> &nbsp;— the instrument's LEGAL view (what a certification engine reads)<br>
          <span class="hl-world">/world</span> &nbsp;— REALITY: the load, the chamber, the clock (you drive it)
        </div>
        <div class="welcome-hint">
          Try the buttons above, or type a command. Press
          <span class="kbd">Tab</span> to complete,
          <span class="kbd">↑</span><span class="kbd">↓</span> for history,
          <span class="kbd">PgUp</span><span class="kbd">PgDn</span> to scroll.
          Type <span class="hl">tour</span> for the narrated walkthrough.
        </div>
      </div>
      <div
        v-for="(line, i) in logLines"
        :key="i"
        class="line"
        :class="line.cls"
        v-html="line.html"
      />
    </div>

    <div v-if="showNewOutput" class="new-output" @click="scrollToBottom" role="button" tabindex="0">
      ↓ new output
    </div>

    <div v-if="acState && acState.matches.length" class="ac-popover scroll-pretty">
      <div
        v-for="(m, i) in acState.matches"
        :key="m.text + i"
        class="ac-item"
        :class="{ selected: i === acState!.idx }"
        @click="chooseAc(i)"
        @mouseenter="acState!.idx = i"
      >
        <span class="ac-cmd">{{ m.text || '—' }}</span>
        <span class="ac-desc">{{ m.desc }}</span>
      </div>
    </div>

    <form class="console-input-row" :class="{ privileged: state.privileged }" @submit.prevent="onSubmit">
      <span class="prompt">{{ promptText }}</span>
      <div ref="shellRef" class="console-input-shell">
        <span ref="cursorRef" class="block-cursor blink" aria-hidden="true" />
        <input
          id="terminal-input"
          ref="inputRef"
          v-model="inputValue"
          class="console-input"
          autocomplete="off"
          autocapitalize="off"
          autocorrect="off"
          spellcheck="false"
          aria-label="console input"
          @keydown="onKeydown"
          @input="onInput"
          @click="positionCursor"
          @keyup="positionCursor"
          @focus="onFocus"
          @blur="onBlur"
        />
      </div>
      <div class="console-hint">
        <span><span class="kbd">Tab</span> complete</span>
        <span><span class="kbd">↑↓</span> history</span>
        <span><span class="kbd">PgUp</span> scroll</span>
      </div>
    </form>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { parseCommand } from '@primmel/sst-runtime/console/grammar'
import { execute, promptOf, type ConsoleIo, type ConsoleState } from '@primmel/sst-runtime/console/client'
import { gql, isUnauthorized, setWorldToken, clearWorldToken } from '../api.js'
import { complete, completeApplyPrefix, type Completion } from '../lib/autocomplete.js'
import { bench, startTour, type TourStep } from '../lib/store.js'

interface LogLine { cls: string; html: string }
interface AcState { partial: string; matches: Completion[]; idx: number }

const HISTORY_KEY = 'sim.console.history'
const HISTORY_MAX = 100

const logRef      = ref<HTMLDivElement | null>(null)
const inputRef    = ref<HTMLInputElement | null>(null)
const shellRef    = ref<HTMLDivElement | null>(null)
const cursorRef   = ref<HTMLSpanElement | null>(null)

const logLines    = ref<LogLine[]>([])
const inputValue  = ref('')
const showNewOutput = ref(false)
const acState     = ref<AcState | null>(null)

const state: ConsoleState = reactive({ privileged: false, watching: false })

const promptText = computed(() => promptOf(state))

// ── History (Up/Down cycle) ─────────────────────────────────────────
let history: string[] = []
let historyIdx = 0
let liveInputDraft = ''

function loadHistory(): string[] {
  try { return JSON.parse(sessionStorage.getItem(HISTORY_KEY) ?? '[]') as string[] } catch { return [] }
}
function saveHistory(h: string[]): void {
  try { sessionStorage.setItem(HISTORY_KEY, JSON.stringify(h.slice(-HISTORY_MAX))) } catch { /* private mode */ }
}
function pushHistory(line: string): void {
  if (line && line !== history[history.length - 1]) {
    history.push(line)
    saveHistory(history)
  }
  historyIdx = history.length
}

// ── Channel IO ───────────────────────────────────────────────────────
const io: ConsoleIo = {
  write: text => {
    const trimmed = text.replace(/\n$/, '')
    if (trimmed.startsWith('% — ')) {
      appendLine('narrate', `<span class="marker">—</span> ${escapeHtml(trimmed.slice(4))}`)
    } else if (trimmed.startsWith('% > ')) {
      appendLine('tour-cmd', `<span class="prompt">${escapeHtml(promptOf(state))}</span>${escapeHtml(trimmed.slice(3))}`)
    } else {
      appendLine('out', escapeHtml(trimmed))
    }
  },
  query: async (channel, query) => {
    let result = await gql(bench.baseUrl, channel, query)
    if (channel === '/world' && isUnauthorized(result)) {
      const token = window.prompt('This sim guards /world mutations — enter the world token (SIM_WORLD_TOKEN).')
      if (token) {
        setWorldToken(token)
        result = await gql(bench.baseUrl, channel, query)
        if (isUnauthorized(result)) clearWorldToken()
      }
    }
    return result
  },
}

// ── Log append + auto-scroll discipline ──────────────────────────────
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}
function appendLine(cls: string, html: string): void {
  logLines.value.push({ cls, html })
  nextTick(maybeScroll)
}
function appendEcho(line: string): void {
  const cls = state.privileged ? 'echo privileged' : 'echo'
  appendLine(cls, `<span class="prompt">${escapeHtml(promptOf(state))}</span>${escapeHtml(line)}`)
}
function appendError(msg: string): void { appendLine('err', `% ${escapeHtml(msg)}`) }

function isAtBottom(): boolean {
  const el = logRef.value
  if (!el) return true
  return el.scrollHeight - el.scrollTop - el.clientHeight < 24
}
let wasAtBottomOnLastOutput = true
function maybeScroll(): void {
  const el = logRef.value
  if (!el) return
  if (isAtBottom() || wasAtBottomOnLastOutput) {
    el.scrollTop = el.scrollHeight
    showNewOutput.value = false
  } else {
    showNewOutput.value = true
  }
  wasAtBottomOnLastOutput = isAtBottom()
}
function onLogScroll(): void {
  if (isAtBottom()) showNewOutput.value = false
  wasAtBottomOnLastOutput = isAtBottom()
}
function scrollToBottom(): void {
  const el = logRef.value
  if (el) el.scrollTop = el.scrollHeight
  showNewOutput.value = false
  inputRef.value?.focus()
}
function focusInput(): void { inputRef.value?.focus() }

// ── Custom block cursor ──────────────────────────────────────────────
let measuringFont = ''
const measureCanvas = typeof document !== 'undefined' ? document.createElement('canvas') : null
const measureCtx = measureCanvas?.getContext('2d') ?? null

function ensureFont(): string {
  if (measuringFont || !inputRef.value) return measuringFont
  const cs = getComputedStyle(inputRef.value)
  measuringFont = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} / ${cs.lineHeight} ${cs.fontFamily}`
  return measuringFont
}
function positionCursor(): void {
  if (!cursorRef.value || !inputRef.value) return
  ensureFont()
  const before = inputValue.value.slice(0, inputRef.value.selectionStart ?? inputValue.value.length)
  let w = 0
  if (measureCtx && measuringFont) {
    measureCtx.font = measuringFont
    w = measureCtx.measureText(before).width
  }
  cursorRef.value.style.transform = `translateX(${w}px)`
}
function blinkKick(): void {
  if (!cursorRef.value) return
  cursorRef.value.classList.remove('blink')
  void cursorRef.value.offsetWidth  // force reflow
  cursorRef.value.classList.add('blink')
}
function showCursor(): void { if (cursorRef.value) cursorRef.value.style.opacity = '1' }
function hideCursor(): void { if (cursorRef.value) cursorRef.value.style.opacity = '0' }

function onFocus(): void { showCursor(); positionCursor() }
function onBlur(): void { hideCursor(); dismissAc(true) }
function onInput(): void {
  dismissAc(true)
  positionCursor()
  blinkKick()
}

// ── Autocomplete ─────────────────────────────────────────────────────
function renderAc(): void { /* v-if + v-for handle the rendering */ }
function applyAcSelection(): void {
  if (!acState.value) return
  const m = acState.value.matches[acState.value.idx]!
  if (!m.text) return  // a hint-only entry (e.g. "then the kg value")
  const prefix = completeApplyPrefix(acState.value.partial)
  inputValue.value = prefix ? `${prefix} ${m.text}` : m.text
  positionCursor()
}
function dismissAc(restorePartial: boolean): void {
  if (restorePartial && acState.value) inputValue.value = acState.value.partial
  acState.value = null
  void renderAc
}
function chooseAc(i: number): void {
  if (!acState.value) return
  acState.value.idx = i
  applyAcSelection()
  dismissAc(false)
  inputRef.value?.focus()
}

// ── Keyboard handling ────────────────────────────────────────────────
function onKeydown(e: KeyboardEvent): void {
  // PgUp / PgDn — page-scroll the log
  if (e.key === 'PageUp')   { e.preventDefault(); logRef.value?.scrollBy({ top: -(logRef.value.clientHeight * 0.8) }); return }
  if (e.key === 'PageDown') { e.preventDefault(); logRef.value?.scrollBy({ top:  (logRef.value.clientHeight * 0.8) }); return }
  // Ctrl/Cmd-L — clear the log
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'l') {
    e.preventDefault()
    logLines.value = []
    return
  }
  // Tab / Shift+Tab — autocomplete cycling
  if (e.key === 'Tab') {
    e.preventDefault()
    const reverse = e.shiftKey
    const typed = inputValue.value
    if (!acState.value) {
      const matches = complete(typed)
      if (matches.length === 0) return
      if (matches.length === 1) {
        inputValue.value = matches[0]!.text
        positionCursor(); blinkKick()
        return
      }
      acState.value = { partial: typed, matches, idx: reverse ? matches.length - 1 : 0 }
    } else {
      const n = acState.value.matches.length
      acState.value.idx = (acState.value.idx + (reverse ? -1 : 1) + n) % n
    }
    applyAcSelection()
    blinkKick()
    return
  }
  // Escape — dismiss autocomplete, restore partial
  if (e.key === 'Escape' && acState.value) { dismissAc(true); return }

  // Up / Down — command history (only when autocomplete closed)
  if (!acState.value && e.key === 'ArrowUp') {
    e.preventDefault()
    if (history.length === 0) return
    if (historyIdx === history.length) liveInputDraft = inputValue.value
    historyIdx = Math.max(0, historyIdx - 1)
    inputValue.value = history[historyIdx] ?? ''
    nextTick(() => { positionCursor(); blinkKick() })
    return
  }
  if (!acState.value && e.key === 'ArrowDown') {
    e.preventDefault()
    if (historyIdx >= history.length) return
    historyIdx++
    inputValue.value = historyIdx === history.length ? liveInputDraft : (history[historyIdx] ?? '')
    nextTick(() => { positionCursor(); blinkKick() })
    return
  }
}

function onSubmit(): void {
  const line = inputValue.value
  if (acState.value) dismissAc(false)
  inputValue.value = ''
  nextTick(positionCursor)
  if (line.trim() === '') return
  appendEcho(line)
  pushHistory(line)
  void run(line)
}

// ── The command runner: shared by submit, quick-actions, tour ────────
async function run(line: string, opts: { echo?: boolean; elevate?: boolean } = {}): Promise<void> {
  // The 'tour' command is intercepted: the legacy all-at-once runner is
  // replaced by the step-by-step TourRunner. The user clicks Next to
  // advance — no more 15-second hang.
  if (line.trim() === 'tour' && !bench.tour.active) {
    if (opts.echo) appendEcho(line)
    await startTour()
    return
  }
  const wasPrivileged = state.privileged
  if (opts.elevate) state.privileged = true
  try {
    const action = parseCommand(line)
    if (action.kind === 'exit') {
      appendLine('out', '% close the tab to exit — the sim keeps running')
      return
    }
    try {
      const text = await execute(action, io, state)
      if (text) io.write(text + '\n')
    } catch (err) {
      appendError(err instanceof Error ? err.message : String(err))
    }
    bench.privileged = state.privileged
  } finally {
    state.privileged = wasPrivileged
    bench.privileged = state.privileged
  }
}

// ── Tour step executor: one step at a time, into this log ────────────
// Registered as bench.runTourStep so the TourRunner (and store.startTour
// / nextTourStep) can drive it. The step's narration is shown as a
// narrate-styled block; the command is echoed (privileged); the result
// is appended as normal output. The TourRunner panel above shows the
// same narration + a Next/Skip pair — the log is the trace, the panel
// is the live progress marker.
async function runTourStep(step: TourStep): Promise<void> {
  const wasPrivileged = state.privileged
  state.privileged = true
  try {
    if (step.narrate) appendLine('narrate', `<span class="marker">—</span> ${escapeHtml(step.narrate)}`)
    appendLine('tour-cmd', `<span class="prompt">${escapeHtml(promptOf(state))}</span>${escapeHtml(step.command)}`)
    const action = parseCommand(step.command)
    if (action.kind === 'unknown') {
      appendError(`tour step command did not parse: '${step.command}'`)
      return
    }
    try {
      const text = await execute(action, io, state)
      if (text) io.write(text + '\n')
    } catch (err) {
      appendError(err instanceof Error ? err.message : String(err))
    }
    bench.privileged = state.privileged
  } finally {
    state.privileged = wasPrivileged
    bench.privileged = state.privileged
  }
}

// ── Lifecycle ────────────────────────────────────────────────────────
let onScrollHandler: (() => void) | undefined
let onResizeHandler: (() => void) | undefined
let fontsReadyHandler: (() => void) | undefined

onMounted(() => {
  history = loadHistory()
  historyIdx = history.length
  bench.runCommand = async (cmd, opts) => { await run(cmd, opts) }
  bench.runTourStep = runTourStep

  onScrollHandler = onLogScroll
  logRef.value?.addEventListener('scroll', onScrollHandler)
  onResizeHandler = positionCursor
  window.addEventListener('resize', onResizeHandler)
  fontsReadyHandler = positionCursor
  if ((document as Document & { fonts?: { ready?: Promise<unknown> } }).fonts?.ready) {
    (document.fonts as FontFaceSet).ready.then(fontsReadyHandler)
  }
  nextTick(() => {
    positionCursor()
    inputRef.value?.focus()
  })
})

onBeforeUnmount(() => {
  bench.runCommand = null
  bench.runTourStep = null
  if (onScrollHandler) logRef.value?.removeEventListener('scroll', onScrollHandler)
  if (onResizeHandler) window.removeEventListener('resize', onResizeHandler)
})
</script>

<style scoped>
.console-body {
  flex: 1; min-height: 0;
  display: flex; flex-direction: column;
  background: var(--color-inset);
  position: relative;
}

.console-log {
  flex: 1; overflow-y: auto;
  padding: 1rem;
  font-family: var(--font-mono);
  font-size: 0.78rem; line-height: 1.55;
  color: var(--color-fg);
  scroll-behavior: smooth;
}
.line { white-space: pre-wrap; word-break: break-word; }
.line + .line { margin-top: 2px; }
.line :deep(.prompt) { color: var(--color-twin); margin-right: 0.5rem; font-weight: 600; }
.line.echo.privileged :deep(.prompt) { color: var(--color-world); }
.line.out { color: var(--color-fg-dim); }
.line.err { color: var(--color-err); }
.line.narrate {
  color: var(--color-fg-dim); font-style: italic;
  border-left: 2px solid var(--color-twin-line);
  padding-left: 0.75rem; margin: 0.5rem 0;
}
.line.narrate :deep(.marker) { color: var(--color-twin); font-style: normal; margin-right: 0.5rem; }
.line.tour-cmd { color: var(--color-fg-mute); }
.line.tour-cmd :deep(.prompt) { color: var(--color-twin); margin-right: 0.5rem; }
.line.welcome {
  color: var(--color-fg);
  padding: 0.75rem 0;
  border-bottom: 1px solid var(--color-line);
  margin-bottom: 0.75rem;
}
.welcome-title {
  font-family: var(--font-display); font-size: 0.95rem; font-weight: 600;
  margin-bottom: 4px;
}
.welcome-title .hl { color: var(--color-twin); }
.welcome-title .mute { color: var(--color-fg-mute); }
.welcome-body { margin-bottom: 0.5rem; }
.welcome-channels { margin: 0.375rem 0; line-height: 1.7; }
.welcome-channels .hl-twin  { color: var(--color-twin);  font-weight: 600; }
.welcome-channels .hl-world { color: var(--color-world); font-weight: 600; }
.welcome-hint {
  margin-top: 0.625rem; color: var(--color-fg-dim); font-size: 0.76rem;
  line-height: 1.7;
}
.welcome-hint .hl { color: var(--color-twin); font-family: var(--font-mono); }
.welcome-hint .kbd {
  font-family: var(--font-mono); color: var(--color-fg);
  padding: 1px 5px; border: 1px solid var(--color-line-strong);
  border-radius: 3px; margin: 0 1px; font-size: 0.72rem;
}

.new-output {
  position: absolute; bottom: 3rem; right: 1rem;
  background: var(--color-surface-3);
  border: 1px solid var(--color-line-strong);
  color: var(--color-fg);
  padding: 2px 0.75rem; border-radius: 999px;
  font-family: var(--font-mono); font-size: 0.7rem;
  cursor: pointer;
  box-shadow: 0 6px 18px rgba(0,0,0,0.5);
  z-index: 4;
}
.new-output:hover { background: var(--color-twin-soft); border-color: var(--color-twin-line); color: var(--color-twin-bright); }

.ac-popover {
  position: absolute; bottom: 100%; left: 0; right: 0;
  background: var(--color-surface-2);
  border: 1px solid var(--color-line-strong);
  border-radius: 6px;
  box-shadow: 0 6px 18px rgba(0,0,0,0.5);
  max-height: 220px; overflow-y: auto;
  z-index: 10;
  margin-bottom: 2px;
}
.ac-item {
  padding: 0.5rem 0.75rem;
  font-family: var(--font-mono); font-size: 0.76rem;
  color: var(--color-fg);
  cursor: pointer;
  display: flex; align-items: baseline; gap: 0.75rem;
}
.ac-item .ac-cmd  { color: var(--color-twin-bright); font-weight: 500; min-width: 9rem; }
.ac-item .ac-desc { color: var(--color-fg-mute); font-size: 0.7rem; }
.ac-item:hover, .ac-item.selected { background: var(--color-surface-3); }
.ac-item.selected { box-shadow: inset 2px 0 0 var(--color-twin); }

.console-input-row {
  display: flex; align-items: center;
  padding: 0.75rem 1rem;
  border-top: 1px solid var(--color-line);
  background: var(--color-surface-1);
  gap: 0.5rem; flex-shrink: 0;
}
.console-input-row .prompt {
  font-family: var(--font-mono);
  font-size: 0.82rem; font-weight: 600;
  color: var(--color-twin); flex-shrink: 0;
}
.console-input-row.privileged .prompt { color: var(--color-world); }
.console-input-shell {
  position: relative;
  flex: 1; display: flex; align-items: center;
}
.block-cursor {
  position: absolute;
  left: 0; top: 50%;
  width: 0.55em; height: 1.4em;
  margin-top: -0.7em;
  background: var(--color-twin);
  box-shadow: 0 0 6px var(--color-twin);
  pointer-events: none;
  z-index: 0;
  opacity: 0;
}
.console-input-row.privileged .block-cursor {
  background: var(--color-world);
  box-shadow: 0 0 6px var(--color-world);
}
.console-input {
  width: 100%;
  background: transparent;
  border: 0; outline: 0;
  color: var(--color-fg);
  font-family: var(--font-mono);
  font-size: 0.82rem;
  padding: 0.25rem 0;
  caret-color: transparent;
  position: relative;
  z-index: 1;
}
.console-hint {
  font-family: var(--font-mono); font-size: 0.66rem;
  color: var(--color-fg-mute);
  flex-shrink: 0;
  display: flex; gap: 0.75rem;
}
.console-hint .kbd {
  padding: 1px 5px;
  border: 1px solid var(--color-line-strong);
  border-radius: 3px;
  color: var(--color-fg-dim);
  margin: 0 1px;
}

@media (max-width: 960px) {
  .console-hint { display: none; }
}
</style>
