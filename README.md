# sim-instruments — Simulated SMART devices

A library of **simulated measuring instruments** — software wind tunnels
for the Primmel/OIML SMART ecosystem.

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

Docs: the design is `docs/2026-07-26-simulated-instruments-design.md`.
Doctrine background: [primmel-oiml-smart](https://www.primmel.org/primmel-oiml-smart/)
chapters 14–15.

## Status

Design approved; implementation starting. The standalone promise:
`git clone … && npm install && npm start` boots a simulated load
cell with its console, its GraphQL channels (with GraphiQL
playgrounds), and the virtual-bench web app at
`http://localhost:5290/` — no SMART checkout, no Primmel knowledge
required.

