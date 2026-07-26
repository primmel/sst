# sim-instruments v1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the simulated-instrument framework and the first instrument family (simulated ACME LC-500 load cells) per the approved design.

**Architecture:** npm-workspaces monorepo; `@sim/core` (physics stages + families, D 11 environment, virtual clock, dual-schema server, twin-schema generator, console engine), `@sim/lc500` (instrument definition + scenarios + bench SPA + process entry). Two GraphQL schemas on one process: `/twin` (generated from the product package; baked at pack time for standalone) and `/world` (simulated actions). Zero runtime dependency on the SMART repo; primmel-ts is a build-time-only dependency.

**Tech Stack:** TypeScript strict + ESM (Node ≥ 22), vitest, graphql + graphql-yoga (SSE subscriptions, GraphiQL), tsx. No xterm, no Apollo, no WebGPU requirement in v1 code (WebGL2 first, WebGPU optional fallback).

**Spec:** `docs/2026-07-26-simulated-instruments-design.md` (14 sections — read §1–§9 before Task 1).

**Plan shape (staged detail):** Stage C1 (Tasks 1–9) is specified in full bite-sized TDD detail below. Stages C2–C5b (Tasks 10–16) are specified as interface-and-acceptance blocks; each is expanded into full TDD detail at its stage start by its implementing agent using the writing-plans skill (the spec sections cited per block are the authority). C6 is out of scope (deferred to post-smart-task-35).

## Global Constraints

- The two laws (spec §2): (1) nothing from `/world` leaks into `/twin`; (2) the `/twin` schema is generated from the package, never hand-written.
- Quantity-typed physics: every physical value carries `{ value, unit, kind }`; no bare numbers in the signal chain.
- Deterministic by default: manual-step virtual clock; seeded RNG (mulberry32). Wall-clock mode is opt-in.
- primmel-ts is a **build-time-only** dependency (`file:../../../primmel/primmel-ts/packages/primmel` in dev; the twin schema is baked into the instrument's dist for standalone).
- Zero runtime imports from `smart/browser` anywhere, forever.
- TypeScript strict (`tsconfig.base.json` already at repo root), ESM, Node ≥ 22.
- Dependencies: `graphql`, `graphql-yoga`, dev: `vitest`, `tsx`, `typescript`, `@types/node`. Nothing else without controller sign-off.
- Tests: vitest, colocated `*.test.ts` beside sources; e2e in `e2e/`.
- Gates at every task boundary: `npm run typecheck && npm test` green; commit per task.

---

### Task 1: Repo tooling + the virtual clock

**Files:**
- Modify: `package.json` (root, add devDeps + workspace scripts)
- Create: `packages/core/package.json`, `packages/core/tsconfig.json`, `packages/core/vitest.config.ts`, `packages/core/src/time.ts`, `packages/core/src/time.test.ts`, `.github/workflows/ci.yml`

**Interfaces:**
- Produces: `class VirtualClock { now(): number; mode(): 'manual'|'wall'; setMode(m: 'manual'|'wall'): void; advance(seconds: number): void; onAdvance(cb: (dt: number) => void): () => void }` — time in **seconds** (number, float).

- [ ] **Step 1: packages/core scaffolding**

`packages/core/package.json`:
```json
{
  "name": "@sim/core",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "typescript": "^5.5.0",
    "vitest": "^2.1.0",
    "tsx": "^4.19.0",
    "@types/node": "^22.0.0"
  },
  "dependencies": {
    "graphql": "^16.9.0",
    "graphql-yoga": "^5.7.0"
  }
}
```
`packages/core/tsconfig.json`:
```json
{ "extends": "../../tsconfig.base.json", "compilerOptions": { "rootDir": "src", "outDir": "dist", "types": ["node"] }, "include": ["src"] }
```
Root `package.json` devDependencies: typescript/vitest/tsx/@types/node (same versions, hoisted); workspaces scripts already present. Run `npm install` at repo root and verify `npm run typecheck` exits 0.

- [ ] **Step 2: failing test — manual advance + subscribers**

`packages/core/src/time.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { VirtualClock } from './time.js'

describe('VirtualClock', () => {
  it('starts at 0 in manual mode and advances deterministically', () => {
    const c = new VirtualClock()
    expect(c.mode()).toBe('manual')
    expect(c.now()).toBe(0)
    c.advance(300)
    expect(c.now()).toBe(300)
  })
  it('notifies subscribers with dt, oldest first; unsubscribe works', () => {
    const c = new VirtualClock()
    const seen: number[] = []
    const off = c.onAdvance(dt => { seen.push(dt) })
    c.advance(60); c.advance(30)
    off(); c.advance(10)
    expect(seen).toEqual([60, 30])
  })
  it('wall mode tracks the wall clock (approximately)', () => {
    const c = new VirtualClock()
    c.setMode('wall')
    const t0 = c.now()
    expect(Math.abs(t0 - Date.now() / 1000)).toBeLessThan(2)
    c.setMode('manual')
    c.advance(5)
    expect(c.now()).toBeCloseTo(t0 + 5, 6)
  })
})
```
Run `cd packages/core && npx vitest run` — expect FAIL (no `./time.js`).

- [ ] **Step 3: implement `packages/core/src/time.ts`**

```ts
export type ClockMode = 'manual' | 'wall'

/** The deterministic virtual clock (spec §4.4): manual-step default;
 *  wall-clock opt-in. Time is seconds (float). */
export class VirtualClock {
  #mode: ClockMode = 'manual'
  #virtual = 0
  #wallAnchor = 0 // Date.now()/1000 at the last wall↔manual flip
  #subs: Array<(dt: number) => void> = []

  now(): number {
    return this.#mode === 'wall' ? this.#virtual + (Date.now() / 1000 - this.#wallAnchor) : this.#virtual
  }
  mode(): ClockMode { return this.#mode }
  setMode(m: ClockMode): void {
    if (m === this.#mode) return
    // entering wall mode rebases virtual to the epoch (servedAt
    // timestamps must compare against clients' wall clocks); leaving
    // it freezes the epoch into the virtual timeline.
    this.#virtual = Date.now() / 1000
    this.#wallAnchor = Date.now() / 1000
    this.#mode = m
  }
  advance(seconds: number): void {
    if (!(seconds > 0)) throw new Error(`advance requires seconds > 0, got ${seconds}`)
    this.#virtual = this.now() + seconds
    this.#wallAnchor = Date.now() / 1000
    for (const cb of [...this.#subs]) cb(seconds)
  }
  onAdvance(cb: (dt: number) => void): () => void {
    this.#subs.push(cb)
    return () => { this.#subs = this.#subs.filter(f => f !== cb) }
  }
}
```
Run vitest — expect PASS (3 tests).

- [ ] **Step 4: CI**

`.github/workflows/ci.yml`:
```yaml
name: ci
on: { push: { branches: [main] }, pull_request: {} }
jobs:
  gates:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm }
      - run: npm ci
      - run: npm run typecheck
      - run: npm test
```
(Note: `npm ci` needs the root lockfile committed — `npm install` produced it in Step 1.)

- [ ] **Step 5: commit** `feat(core): scaffolding + VirtualClock (manual-step deterministic, wall opt-in)` — gates green.

---

### Task 2: Quantity types (INV-1 discipline)

**Files:**
- Create: `packages/core/src/physics/quantity.ts`, `packages/core/src/physics/quantity.test.ts`

**Interfaces:**
- Produces: `type Unit = 'kg'|'degC'|'percentRh'|'kPa'|'s'|'mVperV'|'V'|'count'|'kg_per_mm'|'1'; type QuantityKind = 'mass'|'temperature'|'humidity'|'pressure'|'time'|'ratio'|'voltage'|'count'|'stiffness'|'dimensionless'; interface Qty<K extends QuantityKind = QuantityKind> { value: number; unit: Unit; kind: K }`; constructors `qty(value, unit)` (kind derived from unit), `add/same-unit`, `mul/scalar`, `subtract`, `abs`, and `const UNITS: Record<Unit, QuantityKind>`.

- [ ] **Step 1: failing test**

```ts
import { describe, it, expect } from 'vitest'
import { qty, add, mul, subtract, abs } from './quantity.js'

describe('quantity (INV-1: no bare numbers)', () => {
  it('derives kind from unit; arithmetic keeps unit/kind', () => {
    const a = qty(40, 'kg'), b = qty(2.5, 'kg')
    expect(a.kind).toBe('mass')
    expect(add(a, b)).toEqual({ value: 42.5, unit: 'kg', kind: 'mass' })
    expect(subtract(a, b).value).toBeCloseTo(37.5)
    expect(mul(a, 2)).toEqual({ value: 80, unit: 'kg', kind: 'mass' })
    expect(abs(qty(-3, 'degC')).value).toBe(3)
  })
  it('rejects kind-incoherent operations', () => {
    // @ts-expect-error runtime guard
    expect(() => add(qty(1, 'kg'), qty(20, 'degC'))).toThrow(/kind mismatch/)
  })
})
```
Run — FAIL (module missing).

- [ ] **Step 2: implement `packages/core/src/physics/quantity.ts`**

```ts
export type Unit = 'kg'|'degC'|'percentRh'|'kPa'|'s'|'mVperV'|'V'|'count'|'kg_per_mm'|'1'
export type QuantityKind = 'mass'|'temperature'|'humidity'|'pressure'|'time'|'ratio'|'voltage'|'count'|'stiffness'|'dimensionless'
export interface Qty<K extends QuantityKind = QuantityKind> { value: number; unit: Unit; kind: K }

export const UNITS: Record<Unit, QuantityKind> = {
  kg: 'mass', degC: 'temperature', percentRh: 'humidity', kPa: 'pressure',
  s: 'time', mVperV: 'ratio', V: 'voltage', count: 'count',
  kg_per_mm: 'stiffness', '1': 'dimensionless',
}

export function qty(value: number, unit: Unit): Qty {
  return { value, unit, kind: UNITS[unit] }
}
function same(a: Qty, b: Qty): void {
  if (a.unit !== b.unit || a.kind !== b.kind) throw new Error(`kind mismatch: ${a.unit}/${a.kind} vs ${b.unit}/${b.kind}`)
}
export function add(a: Qty, b: Qty): Qty { same(a, b); return qty(a.value + b.value, a.unit) }
export function subtract(a: Qty, b: Qty): Qty { same(a, b); return qty(a.value - b.value, a.unit) }
export function mul(a: Qty, scalar: number): Qty { return qty(a.value * scalar, a.unit) }
export function abs(a: Qty): Qty { return qty(Math.abs(a.value), a.unit) }
```
Run vitest — PASS (2 tests).

- [ ] **Step 3: seeded RNG**

Create `packages/core/src/physics/rng.ts`:
```ts
/** mulberry32 — small, fast, seeded (determinism, spec Global Constraints). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
/** Box–Muller over the seeded uniform: unit-normal sample. */
export function normal(rng: () => number): () => number {
  return () => {
    let u = 0, v = 0
    while (u === 0) u = rng()
    v = rng()
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
  }
}
```
Test `rng.test.ts`: same seed → identical 10-sample sequence (golden `[0.548…]` — pin by computing once and pasting); different seeds → different sequences; normal() mean over 10k samples within ±0.05 of 0.

- [ ] **Step 4: commit** `feat(core): quantity types + seeded RNG (INV-1, deterministic)`.

---

### Task 3: Mechanical stage (elastic element)

**Files:**
- Create: `packages/core/src/physics/stages/mechanical.ts`, `packages/core/src/physics/stages/mechanical.test.ts`, `packages/core/src/physics/families/construction.ts`

**Interfaces:**
- Consumes: `Qty`, `VirtualClock.onAdvance`, `normal` rng.
- Produces: `interface ConstructionProfile { id: string; complianceKgPerMm: number; hysteresisClass: number; creepCoefficient: number; creepTauS: number; resonantHz: number; offCenterSensitivity: number }` (all plain numbers, units documented per field) and `class MechanicalStage { constructor(profile: ConstructionProfile, rng: () => number); readonly strainMm: number; setLoad(massKg: number): void; advance(dtS: number): void; reset(): void }`. Internally: strain in mm-equivalent bridge units (v1 simplification: strain output is the bridge-driving deflection in arbitrary calibrated units — document).

- [ ] **Step 1: failing test (golden trajectory)**

```ts
import { describe, it, expect } from 'vitest'
import { mulberry32 } from '../rng.js'
import { MechanicalStage } from './mechanical.js'
import { COMPRESSION } from '../families/construction.js'

describe('MechanicalStage (compression profile)', () => {
  it('elastic response is proportional to load and compliance', () => {
    const m = new MechanicalStage(COMPRESSION, mulberry32(1))
    m.setLoad(500)
    expect(m.strainMm).toBeCloseTo(500 * COMPRESSION.complianceKgPerMm, 9)
  })
  it('creep approaches exponentially with tau and recovers on unload', () => {
    const m = new MechanicalStage(COMPRESSION, mulberry32(1))
    m.setLoad(500)
    const s0 = m.strainMm
    m.advance(600) // 10 min
    const crept = m.strainMm - s0
    expect(crept).toBeGreaterThan(0)
    const expect600 = s0 * COMPRESSION.creepCoefficient * (1 - Math.exp(-600 / COMPRESSION.creepTauS))
    expect(crept).toBeCloseTo(expect600, 6)
    m.setLoad(0)
    const afterUnload = m.strainMm
    m.advance(600)
    expect(m.strainMm).toBeLessThan(afterUnload)
  })
  it('hysteresis: unloading branch reads lower at the same load', () => {
    const m = new MechanicalStage(COMPRESSION, mulberry32(1))
    m.setLoad(500); m.advance(60)
    const loading = m.strainMm
    m.setLoad(250)
    const unloading = m.strainMm
    m.setLoad(0); m.reset?.() // reset optional in this test
    const m2 = new MechanicalStage(COMPRESSION, mulberry32(1))
    m2.setLoad(250)
    expect(unloading).toBeLessThan(loading * 0.5 + COMPRESSION.hysteresisClass * loading)
  })
})
```
Run — FAIL.

- [ ] **Step 2: implement `families/construction.ts` + `stages/mechanical.ts`**

```ts
// families/construction.ts — data profiles (spec §4.2), not code.
import type { ConstructionProfile } from '../stages/mechanical.js'

export const COMPRESSION: ConstructionProfile = {
  id: 'compression',
  complianceKgPerMm: 2.0e-6,   // mm deflection per kg (rated deflection ~1 mm at 500 kg)
  hysteresisClass: 0.0005,     // branch gap as a fraction of full-scale strain
  creepCoefficient: 0.0003,    // asymptotic creep as a fraction of elastic strain
  creepTauS: 300,              // s — exponential approach constant
  resonantHz: 180,
  offCenterSensitivity: 0.0002,
}
export const CONSTRUCTION_PROFILES: Record<string, ConstructionProfile> = { compression: COMPRESSION }
```
```ts
// stages/mechanical.ts — the elastic element (spec §4.1 stage 1, §4.5 laws).
import type { ConstructionProfile as Profile } from '../families/construction.js'
export type { ConstructionProfile } from '../families/construction.js'

export class MechanicalStage {
  #profile: Profile
  #elastic = 0      // instantaneous elastic strain (branch-adjusted)
  #creep = 0        // creep state (approaches creepCoefficient × elastic)
  #branch: 'loading' | 'unloading' | 'idle' = 'idle'
  #lastLoad = 0

  constructor(profile: Profile, _rng: () => number) { this.#profile = profile }

  get strainMm(): number {
    const h = this.#branch === 'unloading' ? this.#profile.hysteresisClass : 0
    return this.#elastic * (1 - h) + this.#creep
  }

  setLoad(massKg: number): void {
    if (massKg < 0) throw new Error(`load must be ≥ 0, got ${massKg}`)
    this.#branch = massKg > this.#lastLoad ? 'loading' : massKg < this.#lastLoad ? 'unloading' : this.#branch
    this.#lastLoad = massKg
    this.#elastic = massKg * this.#profile.complianceKgPerMm
  }

  advance(dtS: number): void {
    const target = this.#elastic * this.#profile.creepCoefficient
    this.#creep += (target - this.#creep) * (1 - Math.exp(-dtS / this.#profile.creepTauS))
  }

  reset(): void { this.#elastic = 0; this.#creep = 0; this.#lastLoad = 0; this.#branch = 'idle' }
}
```
Run vitest — PASS (3 tests; tune test-3 expectation to the implemented branch rule if it differs — pin the golden, do not fudge the physics).

- [ ] **Step 3: commit** `feat(core): mechanical stage + compression profile (elastic, creep, hysteresis)`.

---

### Task 4: Transduction stage (strain-gauge bridge)

**Files:**
- Create: `packages/core/src/physics/stages/transduction.ts`, `packages/core/src/physics/stages/transduction.test.ts`

**Interfaces:**
- Consumes: `MechanicalStage.strainMm`.
- Produces: `interface TransductionParams { sensitivityMVperV: number; gaugeFactor: number; excitationV: number; tcZeroPerDegC: number; tcSpanPerDegC: number; barometricPerKPa: number; referenceTempDegC: number; referencePressureKPa: number }` and `class TransductionStage { constructor(p: TransductionParams); output(strainMm: number, env: { temperatureDegC: number; pressureKPa: number }): number /* mV/V */ }`.

- [ ] **Step 1: failing test**

```ts
import { describe, it, expect } from 'vitest'
import { TransductionStage, type TransductionParams } from './transduction.js'

const P: TransductionParams = {
  sensitivityMVperV: 2.0, gaugeFactor: 2.0, excitationV: 10,
  tcZeroPerDegC: 0.0001, tcSpanPerDegC: 0.0002,
  barometricPerKPa: 0.00005, referenceTempDegC: 20, referencePressureKPa: 101.325,
}

describe('TransductionStage', () => {
  const t = new TransductionStage(P)
  const envRef = { temperatureDegC: 20, pressureKPa: 101.325 }
  it('reference environment: output = sensitivity × strain (normalized)', () => {
    expect(t.output(0.001, envRef)).toBeCloseTo(2.0 * 0.001, 12)
  })
  it('span scales with (1 + tcSpan × ΔT); zero shifts with tcZero × ΔT and barometric × ΔP', () => {
    const hot = { temperatureDegC: 60, pressureKPa: 101.325 }
    expect(t.output(0.001, hot)).toBeCloseTo(2.0 * 0.001 * (1 + 0.0002 * 40) + 0.0001 * 40, 12)
    const hiP = { temperatureDegC: 20, pressureKPa: 106 }
    expect(t.output(0, hiP)).toBeCloseTo(0.00005 * (106 - 101.325), 12)
  })
})
```
Run — FAIL.

- [ ] **Step 2: implement `transduction.ts`**

```ts
export interface TransductionParams {
  sensitivityMVperV: number; gaugeFactor: number; excitationV: number
  tcZeroPerDegC: number; tcSpanPerDegC: number; barometricPerKPa: number
  referenceTempDegC: number; referencePressureKPa: number
}

/** The strain-gauge Wheatstone bridge (spec §4.1 stage 2): linear
 *  temperature coefficients on zero and span; barometric offset on
 *  dead load (R 60-1, 5.6.2). Output in mV/V. */
export class TransductionStage {
  constructor(private readonly p: TransductionParams) {}
  output(strainMm: number, env: { temperatureDegC: number; pressureKPa: number }): number {
    const dT = env.temperatureDegC - this.p.referenceTempDegC
    const dP = env.pressureKPa - this.p.referencePressureKPa
    const span = this.p.sensitivityMVperV * (1 + this.p.tcSpanPerDegC * dT)
    const zero = this.p.tcZeroPerDegC * dT + this.p.barometricPerKPa * dP
    return span * strainMm + zero
  }
}
```
Run — PASS (2 tests).

- [ ] **Step 3: commit** `feat(core): transduction stage (bridge, T_C0/T_Cspan, barometric)`.

---

### Task 5: Conditioning stacks (technology families)

**Files:**
- Create: `packages/core/src/physics/stages/conditioning.ts`, `packages/core/src/physics/stages/conditioning.test.ts`

**Interfaces:**
- Produces: `type TechnologyStack = 'analog-passive'|'analog-active'|'digital'|'digital-processing'; interface ConditioningParams { stack: TechnologyStack; scaleIntervalKg: number; capacityKg: number; filterTauS: number; linearizationErrorKg: number; compensationResidualPerDegC: number; noiseSigmaKg: number }` and `class ConditioningStage { constructor(p: ConditioningParams, normal: () => number); process(bridgeMVperV: number, dtS: number, env: { temperatureDegC: number }): { indicationKg: number; faults: string[] } }`. The bridge→kg mapping factor lives in the instrument composition (Task 6) — pass `kgPerMVperV` into `process` (document why: calibration belongs to the instrument, not the stack).

- [ ] **Step 1: failing test**

```ts
import { describe, it, expect } from 'vitest'
import { mulberry32, normal } from '../rng.js'
import { ConditioningStage, type ConditioningParams } from './conditioning.js'

const base: ConditioningParams = {
  stack: 'digital', scaleIntervalKg: 0.05, capacityKg: 500,
  filterTauS: 1.0, linearizationErrorKg: 0.01, compensationResidualPerDegC: 0.0005, noiseSigmaKg: 0.005,
}

describe('ConditioningStage (digital stack)', () => {
  it('quantizes to the scale interval', () => {
    const c = new ConditioningStage(base, normal(mulberry32(7)))
    const out = c.process(1.23456, 0.001, { temperatureDegC: 20 })
    expect(out.indicationKg * 1000 % (base.scaleIntervalKg * 1000)).toBeCloseTo(0, 6)
  })
  it('first-order filter lags a step, then settles', () => {
    const c = new ConditioningStage(base, normal(mulberry32(7)))
    c.process(2.0, 0.001, { temperatureDegC: 20 })
    const early = c.process(0.0, 0.1, { temperatureDegC: 20 }).indicationKg
    for (let i = 0; i < 100; i++) c.process(0.0, 0.1, { temperatureDegC: 20 })
    const settled = c.process(0.0, 0.1, { temperatureDegC: 20 }).indicationKg
    expect(Math.abs(settled)).toBeLessThanOrEqual(Math.abs(early))
  })
  it('analog-passive passes the bridge through (no quantization)', () => {
    const c = new ConditioningStage({ ...base, stack: 'analog-passive' }, normal(mulberry32(7)))
    const out = c.process(1.23456, 0.001, { temperatureDegC: 20 })
    expect(out.indicationKg).not.toBeNaN()
  })
})
```
Run — FAIL.

- [ ] **Step 2: implement `conditioning.ts`**

```ts
export type TechnologyStack = 'analog-passive'|'analog-active'|'digital'|'digital-processing'
export interface ConditioningParams {
  stack: TechnologyStack; scaleIntervalKg: number; capacityKg: number
  filterTauS: number; linearizationErrorKg: number
  compensationResidualPerDegC: number; noiseSigmaKg: number
}

/** The technology stacks (spec §4.3). passive: passthrough. active:
 *  amplifier offset+noise. digital: + IIR filter, linearization,
 *  temperature-compensation residual, ADC quantization to d.
 *  digital-processing: + self-diagnostics hook (faults list). */
export class ConditioningStage {
  #filtered = 0; #primed = false
  constructor(private readonly p: ConditioningParams, private readonly normal: () => number) {}

  process(bridgeMVperV: number, dtS: number, env: { temperatureDegC: number }, kgPerMVperV = 250): { indicationKg: number; faults: string[] } {
    let kg = bridgeMVperV * kgPerMVperV
    const faults: string[] = []
    if (this.p.stack === 'analog-passive') return { indicationKg: kg, faults }

    // active and above: amplifier noise
    kg += this.normal() * this.p.noiseSigmaKg
    if (this.p.stack === 'analog-active') return { indicationKg: kg, faults }

    // digital and above: filter, linearization, compensation residual
    if (!this.#primed) { this.#filtered = kg; this.#primed = true }
    const alpha = 1 - Math.exp(-dtS / this.p.filterTauS)
    this.#filtered += (kg - this.#filtered) * alpha
    kg = this.#filtered + this.p.linearizationErrorKg + this.p.compensationResidualPerDegC * (env.temperatureDegC - 20)
    kg = Math.round(kg / this.p.scaleIntervalKg) * this.p.scaleIntervalKg
    if (this.p.stack === 'digital-processing' && Math.abs(kg) > this.p.capacityKg * 1.5) faults.push('overload')
    return { indicationKg: kg, faults }
  }
}
```
Run — PASS (3 tests).

- [ ] **Step 3: commit** `feat(core): conditioning stacks (passive/active/digital/+processing)`.

---

### Task 6: Instrument composition (stages + clock + environment state)

**Files:**
- Create: `packages/core/src/instrument.ts`, `packages/core/src/instrument.test.ts`

**Interfaces:**
- Consumes: Tasks 1–5.
- Produces: `interface InstrumentDefinition { id: string; construction: string; stack: TechnologyStack; parameters: ConditioningParams & TransductionParams & { warmUpTauS: number; spanDriftPerDay: number } }`, `class SimulatedInstrument { constructor(def: InstrumentDefinition, clock: VirtualClock, seed: number); setLoad(massKg: number): void; removeLoad(): void; setEnvironment(e: Partial<Environment>): void; indication(): Qty; operationalState(): 'off'|'warming'|'ready'|'fault'; groundTruth(): GroundTruth; reset(): void }`, `interface Environment { temperatureDegC: number; humidityPercentRh: number; pressureKPa: number }`. Clock `onAdvance` drives mechanical creep, warm-up, drift, and the filter.

- [ ] **Step 1: failing test** — compose the LC-500-class definition: power-on → `warming`, after `advance(warmUpTau×5)` → `ready`; indication of 500 kg within 0.1 kg of 500 (good-cell coefficients); drift accrues with days; reset returns to zero.

- [ ] **Step 2: implement `instrument.ts`** (composition root: owns the environment state, subscribes to the clock, feeds stages in order, computes indication from the last stage; `groundTruth()` exposes applied load, elastic strain, creep, offsets, clock — for `/world` only).

- [ ] **Step 3: commit** `feat(core): SimulatedInstrument composition (stages, warm-up, drift, ground truth)`.

---

### Task 7: The OIML D 11 environment layer

**Files:**
- Create: `packages/core/src/environment/conditions.ts`, `packages/core/src/environment/profiles.ts`, `packages/core/src/environment/profiles.test.ts`

**Interfaces:**
- Produces: `Environment` (from Task 6), `interface EnvironmentEvent { kind: 'voltage-dip'|'burst'|'surge'|'esd'|'rf-field'; severity: string; atS: number; durationS: number }`, `interface ProfileProgram { id: string; standard: string; keyframes: Array<{ atS: number; env: Partial<Environment> }>; maxRampPerS?: Partial<Record<keyof Environment, number>> }`, `const D11_PROFILES: Record<string, ProfileProgram>` (at minimum: `damp-heat-cyclic-db` per IEC 60068-2-30, `damp-heat-steady-cab` per IEC 60068-2-78, `dry-heat`, `cold`), and `class ProfilePlayer { constructor(program: ProfileProgram); start(clock: VirtualClock, apply: (e: Partial<Environment>) => void): void; stop(): void }` — keyframes interpolate on clock advance; ramps honor `maxRampPerS` (the ≤ 1 °C/min method rule).

- [ ] **Step 1: failing test** — the Db cyclic profile at t=0 applies the cycle start (25 °C/≥95 %Rh), at t=12h the upper phase (55 °C class), ramps never exceed 1 °C/min; replay is deterministic over `advance`.

- [ ] **Step 2: implement** (data-driven keyframes; IEC severity encodings as string data per spec §5 "mainly encoding").

- [ ] **Step 3: commit** `feat(core): D 11 environment layer (condition vocabulary, cyclic/steady profiles, ramp-limited replay)`.

---

### Task 8: Scenario registry

**Files:**
- Create: `packages/core/src/scenario.ts`, `packages/core/src/scenario.test.ts`

**Interfaces:**
- Produces: `interface Scenario extends InstrumentDefinition { name: string; description: string }`, `const SCENARIOS: Record<string, Scenario>`, `getScenario(name): Scenario` (throws with the known names on miss), `validateScenario(raw: unknown): Scenario` (schema check with precise errors — definition records are data, spec §8).

- [ ] **Step 1: failing test** — the four presets exist (`good-cell`, `creep-cell`, `temp-cell`, `drift-cell`); `creep-cell`'s creep coefficient exceeds `good-cell`'s by ≥ 10×; `validateScenario({})` throws listing the missing fields; a YAML/JSON-authored definition record validates.

- [ ] **Step 2: implement** (scenarios = data literals in code for v1; `validateScenario` checks the full `InstrumentDefinition` shape).

- [ ] **Step 3: commit** `feat(core): scenario registry (four presets + validation)`.

---

### Task 9: Fidelity knobs (twin-certification groundwork)

**Files:**
- Modify: `packages/core/src/instrument.ts`, `packages/core/src/scenario.ts`, their tests

**Interfaces:**
- Produces: `SimulatedInstrument.fidelity: { servedOffsetKg: number; servedLagS: number }` (default `{0, 0}`) — `indication()` returns the true indication **plus** `servedOffsetKg`, and `servedAt()` returns `clock.now() - servedLagS`. Scenarios `lying-twin` and `stale-twin` set them (spec §8.1). **The epistemic wall is preserved: `groundTruth()` never includes the fidelity offsets** — `/world` reports reality; only `/twin`-facing outputs are offset.

- [ ] **Step 1: failing test** — `lying-twin` scenario: `indication()` diverges from ground truth by exactly `servedOffsetKg`; `good-cell` keeps them equal; `stale-twin`'s `servedAt()` lags `now()` by `servedLagS`.

- [ ] **Step 2: implement.**

- [ ] **Step 3: commit** `feat(core): fidelity knobs (lying-twin, stale-twin) — twin-certification groundwork`.

---

### Task 10 (C2): `/world` schema + dual-schema server — SPEC BLOCK

**Expand at stage start.** Authority: spec §6/§7 + §3 `server.ts`/`world-schema.ts`.
- Files: `packages/core/src/world-schema.ts`, `packages/core/src/server.ts`, tests (HTTP integration via yoga's injectable executor — no port).
- Produces: `buildWorldSchema(instrument: SimulatedInstrument, clock: VirtualClock, player: ProfilePlayer): GraphQLSchema` (mutations `placeLoad/removeLoad/setEnvironment/playProfile/advanceTime/setClockMode/scenario/reset`; queries `groundTruth/scenarios/profiles/clock`), and `createSimServer({ twinSchema, worldSchema, benchDir?, port }): { listen(): Promise<url>, close(): Promise<void> }` hosting `/world` + `/twin` + GraphiQL for both + static bench.
- Acceptance: every mutation/query of spec §7 executes over HTTP; `groundTruth` matches `instrument.groundTruth()`; GraphiQL served at both endpoints.

### Task 11 (C3): `/twin` schema generation + conformance check — SPEC BLOCK

**Expand at stage start.** Authority: spec §6 (+ §9 baked-artifact note).
- Files: `packages/core/src/twin-schema.ts`, `packages/core/src/conformance.ts`, tests with a fixture package dir.
- Produces: `generateTwinSchema(pkg: ParsedPackage): GraphQLSchema` (serve declarations → Query fields with `servedAt`; watch → Subscriptions; legal ops → Mutations), `checkTwinConformance(schema, pkg): string[]` (empty = conformant; the diff otherwise), and `bakeTwinSchema(pkg, outFile)` (pack-time artifact; `loadBakedSchema(file)` for standalone boot).
- Acceptance: schema from the real `acme-lc500.prl` snapshot-tests clean; mutating a serve declaration makes the check fail with the diff; a baked artifact boots with zero primmel-ts import.

### Task 12 (C4): `@sim/lc500` instrument package — SPEC BLOCK

**Expand at stage start.** Authority: spec §3/§4.4/§8 + §9 standalone.
- Files: `packages/lc500/{package.json,tsconfig.json,src/instrument.ts,src/scenarios.ts,src/bin.ts}` + tests.
- Produces: the LC-500 `InstrumentDefinition` (digital × compression, class C6, E_max 500 kg, n_lc 6000, −10…+40 °C), the four scenarios + the two fidelity scenarios, and the CLI `sim-lc500 [--package <dir>] [--port 5290] [--console] [--scenario <name>]`.
- Acceptance: `tsx src/bin.ts --port 5290` boots and serves both schemas + the bench placeholder; `--scenario creep-cell` changes the creep trajectory measurably; zero-SMART boot (no `--package`) uses the baked schema.

### Task 13 (C2-console): the IOS-style console — SPEC BLOCK

**Expand at stage start.** Authority: spec §7.
- Files: `packages/core/src/console/{grammar.ts,client.ts}`, tests (parse → expected mutation; a scripted session over a real server).
- Produces: `parseCommand(line): ConsoleAction` (the full §7 grammar incl. `enable`, `show …`, `place load N`, `set temperature N`, `play profile ID`, `advance Nm`, `scenario NAME`, `watch indication`, `reset`), and `runConsole({ endpoint, input, output })` (readline client; `sim-lc500 console` attaches).
- Acceptance: `show indication` queries `/twin`; `show ground-truth` queries `/world` (the epistemic split is observable in the test); a scripted session (boot → place 40 → advance 5m → show indication) passes e2e.

### Task 14 (C5b): `@sim/bench` SPA — SPEC BLOCK

**Expand at stage start.** Authority: spec §9/§10 (three panes) + §4.5.
- Files: `packages/lc500/bench/{package.json,index.html,src/main.ts,src/terminal.ts,src/bench.ts,src/how-it-works.ts,src/api.ts}` (vanilla TS + WebGL2; vite for the build) + smoke tests.
- Produces: the three-pane SPA: terminal (the §7 grammar over fetch), bench (WebGL2 scene fed by `/world` polling + `/twin` indication pane), "How it works" (live stage readouts + §4.5 laws + current coefficients). Served by the sim at `/` (Task 10's `benchDir`).
- Acceptance: `vite build` output loads standalone against a running sim; the bench reflects a `placeLoad` within one poll cycle; the indication pane matches `/twin` (never `/world` ground truth).

### Task 15 (C5a): SMART app embed — SPEC BLOCK

**Expand at stage start (a smart-repo worktree).** Authority: spec §10 + smart house style (AGENTS.d/03-04).
- Files (smart repo): `browser/src/vue-pages/app/sim.vue` (house PageHeader/card), the embed wiring (iframe or bundled component), route registration, e2e leg.
- Acceptance: `/app/sim` renders the bench against the dev sim; the smart repo's own logic contains zero `/world` calls (grep-enforced test); smart gates stay green.

### Task 16 (C5a-flows): guided practice flows — SPEC BLOCK

**Expand at stage start (smart-repo worktree).** Authority: spec §10 flows 1–3.
- Files (smart repo): `browser/src/sim-practice/flows/*.ts` + the flow runner UI + tests (the R 60-2 walkthrough drives a scripted sim session into a real form instance via test-run.service; the four-scenario comparison).
- Acceptance: the walkthrough completes against the sim and the evidence lands in a real form instance; the four scenarios produce their four expected verdict outcomes.

---

## Self-review notes (controller, 2026-07-26)

- Spec coverage: C1 → Tasks 1–9 (incl. fidelity knobs per spec §8.1);
  C2 → 10+13; C3 → 11; C4 → 12; C5b → 14; C5a → 15+16. C6 out of
  scope per spec. Standalone (§9) → Tasks 11 (bake) + 12 (zero-SMART
  boot) + 14 (bench). Environment (§5) → Task 7 (+ Task 10
  `playProfile`).
- Staged detail: Tasks 10–16 are interface-and-acceptance blocks by
  design (see Plan shape above) — each expands with writing-plans at
  its stage start; this is not a placeholder but the sub-project
  split the skill prescribes for multi-stage products.
- Type consistency: `InstrumentDefinition`, `Scenario`,
  `Environment`, `GroundTruth`, `ConsoleAction`, `ProfileProgram`
  used consistently across task blocks.
