# Simulated instruments — the founding design

> **Status:** approved design (2026-07-26), pending spec review →
> implementation plan. **Scope of v1:** the framework (`@primmel/sst-runtime`),
> the first instrument family (`@sim/lc500`, simulated ACME LC-500
> load cells), both GraphQL channels, the IOS-style console, the
> **standalone** virtual-bench web app (runnable with zero SMART —
> §9) — also embedded in the SMART app — and guided practice flows.
> The SMART-side connector + test-bench acceptance e2e (C6) lands
> after smart task 35.
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
SMART talks to *byte-for-byte as it would to a real instrument*. For
a load cell it is a **simulated test bench** — deadweight and
environmental chamber and instrument under test — and the general
idea (the "wind tunnel" analogy): a *controlled physical world in
which the operator sets the ground truth*, so the correct verdict is
known in advance — the platform's own test procedures, verdict chain,
and compliance monitor can be validated against reality-that-we-control.

The rig is instrument-kind-specific: a bench for load cells (force +
environment), a flow rig for water meters (R 49 — genuine fluid
simulation), a road/target simulator for radar speed meters (R 91),
a gas bench for analyzers (R 144). The framework's `/world` actuation
vocabulary is authored per kind; time/environment/scenario come from
core. (Terminology note, 2026-07-26: "wind tunnel" was the user's
analogy for the epistemic property, never a claim that a load cell
involves flow — a load cell is practically a scale.)

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
  core/                     @primmel/sst-runtime — the framework
    src/physics/stages/     composable signal-chain stages (§4):
                            mechanical / transduction / conditioning-output
    src/physics/families/   construction profiles + technology stacks (§4)
    src/environment/        the OIML D 11 layer (§5): condition vocabulary,
                            severity encodings, time-programmed profiles
    src/time.ts             virtual clock (manual-step deterministic; wall-clock opt-in)
    src/scenario.ts         named instrument definitions + physics presets (§8)
    src/twin-schema.ts      package → /twin GraphQL schema + startup conformance check
    src/world-schema.ts     generic simulated-actions schema (§7)
    src/server.ts           dual-schema HTTP server (graphql-yoga, SSE subscriptions)
    src/console/            IOS-like console engine (grammar + readline client)
  lc500/                    @sim/lc500 — the simulated ACME LC-500 family
    src/instrument.ts       the LC-500 instrument definition (family template + parameters)
    src/world.ts            load-cell actuation (placeLoad, removeLoad)
    src/scenarios.ts        good-cell, creep-cell, temp-cell, drift-cell (per template)
    src/bin.ts              process entry: sim-lc500 [--package <acme-lc500.prl>] [--port 5290]
    bench/                  @sim/bench — the standalone bench SPA (§9):
                            terminal + bench + "How it works" panes; served by
                            the sim at `/`, embedded by the SMART app
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
| analogue-passive | none — raw mV/V bridge output; the *indication* forms downstream (see the indicator-pairing note, §14) |
| analogue-active | amplifier: offset, drift, noise; output stage (4–20 mA / 0–10 V) |
| digital | in-cell ADC: quantization at converter resolution; firmware: digital filtering (response time vs noise), linearization, **temperature compensation with residual error** (a prime bench knob) |
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

(2026-07-29, TODO.v2/16: the LC-500's served surface is now exactly the
R 60 governed projection — `environmental_context` left the lc500
contract; the row above still describes the pattern, live on the gas
analyzer's contract.)

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

## 8. Scenarios (the bench knobs)

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

### 8.1 Fidelity scenarios (the twin-certification bench)

A second scenario class injects **twin infidelity** — the physics is
honest, but the twin's *served* values diverge from the instrument's
true state. These exist for the future **Digital Twin certification**
program (`smart/TODO.roadmap/63`): twin fidelity — served value ≡
physical state within bounds + freshness — can only be *measured* by
a vantage that sees both channels, which is exactly the sim's
construction:

| Scenario | Knob | What a twin-fidelity check must do |
|---|---|---|
| `lying-twin` | served indication offset/drift from the true indication (a firmware-mapping fault, not physics) | catch the divergence at probe points (served vs reference beyond the declared bound) |
| `stale-twin` | `servedAt` lags beyond the declared `fresh_within` | flag the freshness violation even though values are accurate |

The certification vantage is a *third actor* (not SMART-the-app, not
the instrument): it reads `/world` reference values and `/twin`
served values at scheduled probe points and judges fidelity — the
sim thus demonstrates both a passing faithful twin and a *caught*
lying twin before the program ever certifies a real one.

## 9. Standalone operation (runnable outside SMART)

The sim is a product in its own right (user direction, 2026-07-26):
an engineer who has never heard of Primmel must be able to run it,
poke it, and learn from it — no SMART checkout, no doctrine reading
required.

- **Zero-SMART runtime.** The instrument ships its `/twin` schema as
  a **baked artifact** (generated from the product package at pack
  time — primmel-ts is a *build-time-only* dependency). `sim-lc500`
  boots with no SMART checkout, no `.prl`, no `PRIMMEL_TS`. Passing
  `--package` re-runs the conformance check against a live package
  when one IS present (the development posture).
- **One process, everything inside.** The server hosts `/twin`,
  `/world`, **GraphiQL playgrounds for both schemas** (graphql-yoga
  built-in — free self-documentation and poking), and `/` — the
  bench SPA. `sim-lc500 console` attaches the IOS console to a
  running instance; `--console` runs server + console in one process.
- **The bench is a sim-repo package** (`@sim/bench`): a
  dependency-light SPA (vanilla TS + WebGL2) with three panes — the
  terminal, the virtual bench, and a **"How it works"** pane (the
  live signal chain: per-stage readouts, the constitutive laws of
  §4.5, the current coefficients — load-cell physics taught from the
  running sim alone). The SMART app's `/app/sim` island **embeds the
  same package**: one bench codebase, two hosts — standalone-first,
  SMART as a consumer.
- **Distribution.** `git clone && npm install && npm start -w @sim/lc500`
  works from day one. The `npx @sim/lc500` path rides an npm publish at
  the v1 release (a release act with the user, not a design
  dependency).
- **The quickstart teaches, Primmel-free.** README quickstart + a
  `tour` console command walk a newcomer: boot → the two channels →
  place a load → watch the indication → sweep the temperature → run
  a scenario → "this is what a certification engine would see".

## 10. The SMART app embed + practice flows

- A house-style island at `/app/sim` **embeds `@sim/bench`** (the
  standalone SPA of §9 — one codebase, two hosts), browser → sim
  direct (CORS). The app's own logic never calls `/world`; the
  terminal is *user*-driven — the user plays the physical world. The
  embed shows the two panes side by side:
  1. **The terminal** — the console grammar of §7.
  2. **The virtual bench** — the WebGL2 scene fed exclusively by
     `/world` state (rendering, never a physics input — §4.5): the
     cell visibly compressing (exaggerated strain map per
     construction profile), the weight landing/removing, chamber
     dials sweeping with the D 11 profile, the virtual clock, and
     the indication display reading `/twin` — instrument-view and
     reality-view side by side, the epistemic split made visceral.
     The cell geometry is a stylized asset per construction profile,
     not a CAD mesh.
- **Practice flows** (app-side content, browser-owned — not generated):
  1. **Free play** — the raw terminal + bench.
  2. **Guided R 60-2 walkthrough** — the
     `measurement-error-repeatability-mdlo` test (smart's R34 pilot
     process): the flow prompts "place 40 kg", polls `/twin` until the
     indication stabilizes inside its window, then writes the reading
     into the *real* form instance via `test-run.service`.
  3. **The four scenario cells** — the same method run against four
     physics presets, four different verdict outcomes.

## 11. SMART integration (C6 — deferred until after smart task 35)

- The task-33 gateway gains a **`graphql` connector** (query + SSE
  subscription transports); a deployment binding registers the sim's
  `/twin` endpoint; the task-34 monitor accrues verdicts against
  sim-served values.
- **The test-bench acceptance e2e** (smart repo): boot the sim →
  bind the gateway → monitor accrues history → inject creep via
  `/world` → verdict `fail`; kill the feed → `indeterminate`; inject
  fault → operational state `fault` opens a service case.
- The pilot's in-process `DemoProvider` stays as the fast path; the
  sim is the real out-of-process path.

## 12. Testing + gates

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

## 13. Build order + parallelization

| Stage | Item | Depends on | Lane |
|---|---|---|---|
| C1 | repo scaffold, stage interfaces, virtual clock, mechanical + transduction stages, scenario registry | — | foundation |
| C2 | `/world` schema + server + console | C1 | parallel |
| C3 | `/twin` schema generation + conformance check | C1 (types) | parallel |
| C4 | `@sim/lc500`: digital + analogue-passive stacks, compression profile, scenarios, bin | C1 | parallel |
| C5a | SMART embed of `@sim/bench` at `/app/sim` + practice flows (smart app) | C5b (the bench package); test-run.service | overlaps |
| C5b | the bench SPA: terminal pane + virtual-bench visualization (WebGL2 renderer fed by `/world`; stylized profile assets) + "How it works" pane | C2 (state) | overlaps |
| C6 | SMART `graphql` connector + test-bench e2e | smart task 35 | deferred |

C2/C3/C4 run concurrently after C1's types land; C5b builds beside
them and C5a embeds it in the app (≤3 agents at the plateau). This
lane has **zero merge contention** with the smart-repo and kernel
lanes running in parallel.

## 14. Explicit non-goals + design notes (v1)

- **Analogue-passive indicator pairing.** A real analogue-passive
  cell has no twin interface — the twin lives on the *indicator*. v1
  models the passive stack's bridge output; how a paired indicator
  model (its own sim stage-chain) hosts `/twin` is a documented
  design note, built when an analogue family template ships.
  STATUS (2026-07-29, smart TODO.v2/09, d2acc07): the pairing SHIPPED
  re-scoped — the paired dial is a ground-truth RENDERING in the bench
  (`packages/core/src/physics/stages/dial.ts` + the bench dial pane,
  fed by the `/world` poll) with the reading entering evidence through
  human observation (`observer_attestation`), deliberately NOT a
  `/twin` serve. The `/twin`-hosting indicator family template above
  remains deferred.
- **EMC events are severity-encoded, not transient-modelled** — a
  burst is a programmed disturbance event with D 11 severity, not a
  circuit-level waveform.
- No auth on `/world` in v1 (localhost development posture;
  documented — a deployment would gate it, `/world` is omnipotent by
  design). **Since TODO.v2/11 the gate exists as an opt-in:**
  `SIM_WORLD_TOKEN` guards `/world` mutations with a bearer token at
  the transport edge (queries and `/twin` stay open; unset = open) —
  see the README's "Guarding /world" section.
- **npm publishing is a release act, not a v1 dependency** — the
  standalone story works from a clone from day one; `npx @sim/lc500`
  rides the v1-release publish decision with the user.
- No instrument #2 (radar, gas analyzer) until the load-cell family
  proves the framework.
- No console tab-completion (v2), no xterm.js in the terminal pane.
