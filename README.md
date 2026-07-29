# sim-instruments — Simulated SMART devices

A library of **simulated measuring instruments** — software test
benches for the Primmel/OIML SMART ecosystem: controlled physical
worlds (loads, environment, time) in which the operator sets the
ground truth, so the correct verdict is known in advance. (The
"wind tunnel" idea, per instrument kind: a bench for load cells, a
flow rig for water meters, a road for radar, a gas bench for
analyzers.)

Each simulated instrument:

- implements the **real physics** of its instrument kind (strain-gauge
  transduction, creep, hysteresis, temperature effects, drift, noise,
  quantization — the physics belongs to the instrument, not to any
  standard), and
- serves the **SMART digital twin interface** (`/twin`, GraphQL) —
  generated from its Primmel product reference package, so the
  interface can never drift from the declared contract, and
- accepts **simulated actions** (`/world`, GraphQL) — the out-of-band
  physical world: place/remove load, set environment, virtual time,
  physics-knob scenarios. Certification software never uses this
  channel; it is simulated reality, not instrument API.

Instrument #1: the **ACME LC-500 load cell** (OIML R 60 territory),
against the `acme-lc500` product reference package in
[oimlsmart/smart](https://github.com/oimlsmart/smart).

Instrument #2: the **reference continuous gas monitor** (OIML R 144
territory — CO by NDIR, NOx by chemiluminescence; gas bench, drift
classes, cross-sensitivity, zero/span calibration). Its twin rides the
declared serve contract until the product reference package lands.

Instrument #3: the **R 91 reference Doppler radar speed meter**
(`@sim/r91`, `sim-r91`) — a stationary K-band CW radar (20–180 km/h,
R 91-1 §6.1; the 6.4 stationary MPE): emission+reflection →
demodulation+estimation → conditioning, with the cosine error,
oscillator drift, rain fade (missed readings, never wrong ones),
vibration/EMI disturbance channels, and the interference-capture
fault. Its twin rides the stand-in serve contract until the SIM-R91-2
product package lands (the handshake test is skip-guarded).

## Guarding `/world` (non-local deployments)

Out of the box the sim is fully open — the localhost development
posture, so a clone runs standalone with zero configuration. Before
any **non-local deployment** (a shared host, a demo server), guard the
physical-actuation channel with one environment variable:

```
SIM_WORLD_TOKEN=<some-long-random-string> npm start
```

With the token set, every `/world` **mutation** (placeLoad,
setEnvironment, injectFault/clearFault, advanceTime, scenario, reset,
the kind knobs…) requires `Authorization: Bearer <token>` and is
otherwise rejected `401` with a clear error — before any resolver
runs. World **queries** (ground truth, clock, scenarios, profiles,
introspection) and the whole `/twin` channel stay open: observing is
free, actuating is guarded. Unset ⇒ everything open, and the server
says so on startup (the honesty line).

Clients: the node console reads the same `SIM_WORLD_TOKEN` from its
environment; the bench terminal prompts for the token on the first
rejected mutation and keeps it for the tab (sessionStorage). The
SMART app carries the token in its own deployment config (the smart
repo's `sim-twin-deployment` knob).

Docs: the design is `docs/2026-07-26-simulated-instruments-design.md`.
Doctrine background: [primmel-oiml-smart](https://www.primmel.org/primmel-oiml-smart/)
chapters 14–15.

## Status

**v1 shipped (2026-07-27)** — the standalone promise is real today:
`git clone … && npm install && npm start` boots a simulated load
cell with its console, its GraphQL channels (with GraphiQL
playgrounds), and the virtual-bench web app at
`http://localhost:5290/` — no SMART checkout, no Primmel knowledge
required. CI: 7/7 jobs green on GitHub Actions (typecheck, tests on
node 22/24, bench build, standalone boot, console session,
bake-freshness). The design is
`docs/2026-07-26-simulated-instruments-design.md`; the implementation
plan `docs/plans/2026-07-26-v1-implementation.md`. The SMART app's
simulated bench + practice flows live at `/app/sim` in
[oimlsmart/smart](https://github.com/oimlsmart/smart); the full
chapter is
[Simulated instruments](https://www.primmel.org/primmel-oiml-smart/platform/02-simulated-instruments/)
on the docs site. Doctrine background:
[primmel-oiml-smart](https://www.primmel.org/primmel-oiml-smart/)
chapters 14–15.

