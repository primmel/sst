# Simulated instruments — the founding design

> **Status:** approved design (2026-07-26), pending spec review →
> implementation plan. **Scope of v1:** the framework (`@sim/core`),
> the first instrument family (`@sim/lc500`, simulated ACME LC-500
> load cells), both GraphQL channels, the IOS-style console, the
> in-app web terminal **with the virtual-bench visualization**, and
> guided practice flows. The SMART-side connector + wind-tunnel
> acceptance e2e (C6) lands after smart task 35.
>
> **Framing (user, 2026-07-26):** not "one model of load cell" — a
> simulation framework for the R 60 *kinds and families* of load
> cells (technology × construction), with an OIML D 11 environmental
> layer.

---

## 1. Why this product exists

The OIML SMART platform certifies and monitors measuring instruments
through their **digital twin interfaces**. Developing and
demonstrating that machinery without hardware today uses an
in-process scripted feed (`smart/browser/src/pilot/deployment.ts`) —
values poked by test narration, with no physical world behind them.

A **simulated SMART device** changes that: a software simulation of a
Primmel-integrated instrument, running as a separate process, that
SMART talks to *byte-for-byte as it would to a real instrument*. It
is a **wind tunnel**: the operator sets the ground truth (loads,
environment, time, physics coefficients), so the correct verdict is
known in advance — the platform's own test procedures, verdict chain,
and compliance monitor can be validated against reality-that-we-control.

And it is a **teaching machine**: a console and a web terminal let a
user perform simulated physical activity step by step — place a load,
sweep the temperature, wait (virtual) five minutes — watch the
indication respond, and practice certifying a load cell end to end.

The long game is a **library** of simulated measuring instruments
(load cells, radar speed meters, gas analyzers, multi-dimensional
instruments), each with its own real physics and its own generated
twin interface.

## 2. Terminology (load-bearing)

- **SMART digital twin interface** — the instrument-facing API that a
  Primmel-integrated instrument natively serves: served registers
  (indication, state, environmental context) with freshness semantics,
  instrument-*legal* operations (zero-setting, self-test invoke), and
  self-description. The Primmel ecosystem *defines* this interface;
  its v1 wire form is **GraphQL**, generated from the instrument's
  product reference package.
- **Simulated SMART device** — a software simulation of an instrument
  that implements that interface.
- **Simulated actions** — the out-of-band physical world: applied
  load, chamber environment, virtual time, physics knobs. *Not*
  instrument API — a real instrument can never report ground-truth
  applied load; the epistemics of testing is comparing *indication*
  (twin channel) against *reference* (world channel).

### The two laws

1. **The epistemic wall.** `/twin` answers only what a real instrument
   could legally answer. Nothing from `/world` leaks into it.
   Certification software is wired to `/twin` only — the discipline is
   enforced by topology (two schemas, two endpoints), not convention.
2. **The twin interface is generated, never hand-written.** The
   `/twin` schema derives from the product package's serve
   declarations; a startup conformance check (schema ≡ serves ≡
   promises) fails the process on any diff.

## 3. Product shape

npm-workspaces monorepo (this repo):

```
packages/
  core/                     @sim/core — the framework
    src/physics/stages/     composable signal-chain stages (§4):
                            mechanical / transduction / conditioning-output
    src/physics/families/   construction profiles + technology stacks (§4)
    src/environment/        the OIML D 11 layer (§5): condition vocabulary,
                            severity encodings, time-programmed profiles
    src/time.ts             virtual clock (manual-step deterministic; wall-clock opt-in)
    src/scenario.ts         named instrument definitions + physics presets (§8)
    src/twin-schema.ts      package → /twin GraphQL schema + startup conformance check
    src/world-schema.ts     generic simulated-actions schema (§6)
    src/server.ts           dual-schema HTTP server (graphql-yoga, SSE subscriptions)
    src/console/            IOS-like console engine (grammar + readline client)
  lc500/                    @sim/lc500 — the simulated ACME LC-500 family
    src/instrument.ts       the LC-500 instrument definition (family template + parameters)
    src/world.ts            load-cell actuation (placeLoad, removeLoad)
    src/scenarios.ts        good-cell, creep-cell, temp-cell, drift-cell (per template)
    src/bin.ts              process entry: sim-lc500 --package <acme-lc500.prl> --port 5290
e2e/                        boot-the-process, drive-both-channels tests
```

Dependency rule: `core` and instruments depend only on **primmel-ts**
(`.prl` parsing for schema generation), `graphql`, and
`graphql-yoga` — never on `smart/browser`. SMART reaches the sim over
HTTP only, forever.

## 4. The physics core: family composition (technology × construction)

R 60 does not describe one load cell — it classifies **kinds and
families**. The sim mirrors that: physics is a **composition of
stages**, and an instrument definition picks a construction profile
and a technology stack. The decomposition deliberately mirrors the
model's own capability graph (`strain-gauge` → `electronic` →
`analogue-active` / `digital`, and the `technology` classification
dimension of R 60-1, 5.7): the sim's family composition *is* the
capability decomposition, executable.

### 4.1 The stage interfaces

```
applied load (kg)
  → [1] MECHANICAL      elastic element: strain, hysteresis memory, creep, resonance
  → [2] TRANSDUCTION    strain-gauge bridge: gauge factor, excitation, temp coefficients
  → [3] CONDITIONING    per technology stack (below)
  → indication (+ operational state)
```

Every value is quantity-typed (unit carried; no bare numbers).
Environment enters stages 1–3 as inputs (§5).

### 4.2 Construction profiles (stage 1)

Per elastic-element geometry — data profiles, not code:

| Profile | Distinguishing mechanics |
|---|---|
| compression (column/canister) | low compliance, low hysteresis class, high capacity |
| shear beam | medium compliance, moment-insensitive |
| bending beam | higher compliance, higher hysteresis class |
| S-type | tension/compression symmetric |
| single-point | off-center (moment) compensation behavior |

A profile carries: compliance, hysteresis class, creep class,
resonant frequency, off-center sensitivity.

### 4.3 Technology stacks (stage 3)

Per the R 60 `technology` attribute values:

| Stack | Physics added |
|---|---|
| analogue-passive | none — raw mV/V bridge output; the *indication* forms downstream (see the indicator-pairing note, §12) |
| analogue-active | amplifier: offset, drift, noise; output stage (4–20 mA / 0–10 V) |
| digital | in-cell ADC: quantization at converter resolution; firmware: digital filtering (response time vs noise), linearization, **temperature compensation with residual error** (a prime wind-tunnel knob) |
| digital + further processing | + self-diagnostics / fault detection (the R 60 `self_test` behavior), richer compensation models |

### 4.4 Instrument definition

An **instrument definition** = construction profile × technology
stack × parameter set (E_max, d, sensitivity, creep coefficient/τ,
temp coefficients, barometric coefficient, noise σ, drift rate,
warm-up τ, compensation residual). The ACME LC-500 v1 definition:
digital stack × compression profile, class C6, E_max 500 kg,
n_lc 6000, rated −10…+40 °C (per its product package).

The virtual clock integrates all time dynamics (creep, warm-up,
drift, environmental profiles): manual-step default
(`advanceTime(seconds)`), wall-clock opt-in; seeded RNG throughout —
golden trajectories are testable.

### 4.5 Why no 3D model (the fidelity grounding)

A realistic behavioral simulation does not need the cell's geometry —
it needs the **constitutive laws and their parameters**. R 60's own
metrology is behavioral (it bounds phenomena; it never references
geometry), and manufacturers characterize cells by *measurement*
(catalog rated output/deflection), not by FEA. Each simulated
phenomenon has a lumped law with parameters sourced from literature,
datasheets, or R 60's test envelopes: compliance (datasheet rated
deflection), hysteresis branch memory (class, R 60-2 error-test
bounds), creep exponentials (fitted to the 30-min envelope + p_lc
apportionment), T_C0/T_Cspan coefficients (datasheet; digital stacks
add compensation residuals), barometric coefficient (R 60-1, 5.6.2),
bridge gauge factor (constant), ADC/firmware (converter resolution,
filter difference equations — pure software), noise σ, warm-up
settling, span-drift rate (R 60-2 warm-up + 28–40-day span-stability
tests). The analog/digital split lives *downstream* of the elastic
element (amplifier → ADC → firmware); load mechanisms enter as
profile constants (compliance, hysteresis class, off-center
sensitivity). A 3D model earns its keep in exactly two places: as a
*rendering asset* for the bench visualization, and as the optional
*offline FEA-calibration* path (SimScale/CalculiX/FEniCS — fitting a
profile's constants from a study when no datasheet exists; a
methodology note, never a runtime dependency).

## 5. The environmental layer (OIML D 11)

The physical world is not just loads. Per OIML D 11 (the umbrella
environmental standard the electronic tests cite — R 60-2 2.10.5–7,
R 144-2 methods), `/world` models the environment as:

- **Encoding first** (the D 11 vocabulary as canonical data):
  condition classes and severity levels — temperature (dry heat,
  cold), relative humidity (damp heat cyclic Db per IEC 60068-2-30;
  damp heat steady Cab per IEC 60068-2-78), barometric pressure,
  supply-voltage variations / dips / short interruptions, and the
  EMC disturbance events (bursts IEC 61000-4-4, surges -4-5, ESD
  -4-2, radiated/conducted RF -4-3/-4-6) as *electrical-environment*
  events with severity encodings. Mainly encoding: the simulator
  needs the canonical vocabulary, not circuit-level transient
  modelling.
- **Some simulated behavior**: environment as *time programs* on the
  virtual clock — a damp-heat cyclic profile playing out over its
  24 h cycle; a temperature ramp respecting the method's
  ≤ 1 °C/min; a humidity dwell; a programmed voltage dip/burst event
  at a virtual timestamp. The physics stages consume the environment:
  temperature coefficients on zero/span, humidity effects on the
  bridge and electronics, barometric effect on dead load, supply
  disturbances on the conditioning stage, EMC events as
  indication disturbances/fault triggers.

This is exactly what the R 60-2 environmental test programs
(2.10.5 humidity cyclic, 2.10.6 steady, 2.10.7.4 voltage variation,
2.10.7.5 dips + warm-up, 2.10.7.6–10 bursts/surges/ESD/RF) *are* — the
sim can play the chamber program of the actual test methods (and
pairs with smart task 56's nine electronic behaviors: their stimuli
are the D 11 factors).

## 6. The `/twin` channel (generated from the package)

primmel-ts parses the product package (`acme-lc500.prl`); its serve
declarations generate the schema:

| Package declaration | Generated schema |
|---|---|
| `serve … indication via get_indication { fresh_within 5s }` | `Query.indication: ServedQuantity!` (value, unit, quantityKind, servedAt) |
| `serve … state via watch_state { fresh_within 1s }` | `Subscription.state: OperationalState!` (SSE) |
| `serve … environmental_context` | `Query.environmentalContext: Environment!` |
| instrument-legal operations | `Mutation.zeroSetting`, `Mutation.selfTest` (v1) |

**Startup conformance check:** the introspected schema ≡ the package's
serve declarations ≡ the mapped promises. Any diff fails the process
with the diff printed — the twin can never drift from its declared
contract.

Fault *injection* is never on `/twin` — `selfTest` only reports what
the instrument's self-diagnostics would legally say (a fault injected
via `/world` surfaces through `/twin` as the operational state, exactly
as a real fault would).

## 7. The `/world` channel + the console

Generic (core-owned) surface, extended per instrument:

```graphql
type Mutation {
  setEnvironment(conditions: EnvironmentInput!): WorldState!
  playProfile(profile: ProfileRef!, at: VirtualTime): WorldState!   # D 11 time programs
  advanceTime(seconds: Float!): WorldState!
  setClockMode(mode: ClockMode!): WorldState!   # manual | wall
  scenario(name: String!): WorldState!
  reset: WorldState!
  # lc500 extension:
  placeLoad(massKg: Float!): WorldState!
  removeLoad: WorldState!
}
type Query {
  groundTruth: GroundTruth!   # appliedLoad, strain, offsets, creepState, environment, clock
  scenarios: [ScenarioInfo!]!
  profiles: [ProfileInfo!]!   # the D 11 profile library
}
```

The **console** (readline client; also embedded in the web terminal):

- Privilege levels IOS-style: `>` user → `enable` → `#` privileged
  (scenarios, physics knobs, reset) → `configure` contexts.
- `show indication` reads **`/twin`** — the instrument's legal view.
- `show ground-truth` reads **`/world`** — reality.
- `place load 40`, `remove load`, `set temperature 60`,
  `set humidity 100`, `play profile damp-heat-cyclic-db`,
  `advance 5m`, `scenario creep-cell`, `watch indication`, `reset`.

The console itself teaches the epistemic split: the two `show`
commands answer from different channels on purpose.

## 8. Scenarios (the wind-tunnel knobs)

A **scenario** = an instrument definition + a physics-preset name —
data, not code. The registry lists them per family template:

| Scenario | Knobs | Expected R 60 outcome |
|---|---|---|
| `good-cell` | all coefficients inside R 60 limits | passes the test program |
| `creep-cell` | creep coefficient/τ beyond MPE | fails creep |
| `temp-cell` | temp coefficients on zero/span excessive (or compensation residual, digital stack) | fails temperature tests |
| `drift-cell` | span-drift rate excessive | fails span-stability |

New family templates (analogue-passive × shear-beam, digital ×
single-point, …) are authored as definition records; the presets
apply per template.

## 9. The web terminal + practice flows (SMART app)

- A house-style island at `/app/sim`, browser → sim direct (CORS).
  The app's own logic never calls `/world`; the terminal is
  *user*-driven — the user plays the physical world. Two panes:
  1. **The terminal** — scrollback + prompt component (no xterm
     dependency): the console grammar of §7.
  2. **The virtual bench** (in v1 per user decision) — a WebGPU/WebGL
     rendering of the bench, **fed exclusively by `/world` state**
     (rendering, never a physics input — §4.5): the cell visibly
     compressing (exaggerated strain map per construction profile),
     the weight landing/removing, chamber dials (temperature,
     humidity, pressure) sweeping with the D 11 profile, the virtual
     clock, and the indication display reading `/twin` — the user
     sees instrument-view and reality-view side by side, the
     epistemic split made visceral. Renderer: a small WebGL2 (or
     WebGPU-with-fallback) scene owned by the app; the cell geometry
     is a stylized asset per construction profile, not a CAD mesh.
- **Practice flows** (app-side content, browser-owned — not generated):
  1. **Free play** — the raw terminal + bench.
  2. **Guided R 60-2 walkthrough** — the
     `measurement-error-repeatability-mdlo` test (smart's R34 pilot
     process): the flow prompts "place 40 kg", polls `/twin` until the
     indication stabilizes inside its window, then writes the reading
     into the *real* form instance via `test-run.service`.
  3. **The four scenario cells** — the same method run against four
     physics presets, four different verdict outcomes.

## 10. SMART integration (C6 — deferred until after smart task 35)

- The task-33 gateway gains a **`graphql` connector** (query + SSE
  subscription transports); a deployment binding registers the sim's
  `/twin` endpoint; the task-34 monitor accrues verdicts against
  sim-served values.
- **The wind-tunnel acceptance e2e** (smart repo): boot the sim →
  bind the gateway → monitor accrues history → inject creep via
  `/world` → verdict `fail`; kill the feed → `indeterminate`; inject
  fault → operational state `fault` opens a service case.
- The pilot's in-process `DemoProvider` stays as the fast path; the
  sim is the real out-of-process path.

## 11. Testing + gates

- **Physics**: golden trajectories per phenomenon with seeded RNG;
  per-stage unit tests (mechanical hysteresis branch memory, creep
  approach + recovery, bridge coefficients, ADC quantization
  boundaries, firmware filter response, compensation residuals).
- **Family composition**: a definition composes the right stages
  (digital ⇒ ADC+firmware present; analogue-passive ⇒ raw bridge
  out); profile data validates against its schema.
- **Environment**: profile programs replay correctly on the virtual
  clock (a Db cycle's phase values at the right virtual timestamps);
  environment inputs reach the stages.
- **Schema generation**: package → schema snapshot; the conformance
  check passes on a faithful package and fails loudly on a mutated
  serve declaration.
- **Channels**: HTTP integration over both schemas (graphql-yoga's
  injectable executor — no port needed in unit tests).
- **Console**: grammar tests, a scripted session end-to-end.
- **e2e/**: boot the process on a test port, drive both channels.
- CI: GitHub Actions (typecheck + test) from day one.

## 12. Build order + parallelization

| Stage | Item | Depends on | Lane |
|---|---|---|---|
| C1 | repo scaffold, stage interfaces, virtual clock, mechanical + transduction stages, scenario registry | — | foundation |
| C2 | `/world` schema + server + console | C1 | parallel |
| C3 | `/twin` schema generation + conformance check | C1 (types) | parallel |
| C4 | `@sim/lc500`: digital + analogue-passive stacks, compression profile, scenarios, bin | C1 | parallel |
| C5a | web terminal + practice flows (smart app) | C2 (terminal); test-run.service | overlaps |
| C5b | virtual-bench visualization (WebGL2/WebGPU renderer fed by `/world`; stylized profile assets) | C2 (state), C5a (the island) | overlaps |
| C6 | SMART `graphql` connector + wind-tunnel e2e | smart task 35 | deferred |

C2/C3/C4 run concurrently after C1's types land; C5a/C5b overlap in
the app (≤3 agents at the plateau). This lane has **zero merge
contention** with the smart-repo and kernel lanes running in parallel.

## 13. Explicit non-goals + design notes (v1)

- **Analogue-passive indicator pairing.** A real analogue-passive
  cell has no twin interface — the twin lives on the *indicator*. v1
  models the passive stack's bridge output; how a paired indicator
  model (its own sim stage-chain) hosts `/twin` is a documented
  design note, built when an analogue family template ships.
- **EMC events are severity-encoded, not transient-modelled** — a
  burst is a programmed disturbance event with D 11 severity, not a
  circuit-level waveform.
- No auth on `/world` in v1 (localhost development posture;
  documented — a deployment would gate it, `/world` is omnipotent by
  design).
- No instrument #2 (radar, gas analyzer) until the load-cell family
  proves the framework.
- No console tab-completion (v2), no xterm.js in the web terminal.
