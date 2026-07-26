# AGENTS.md — sim-instruments

Guidance for agent sessions working in this repository.

## What this repo is

The simulated-instrument library: software simulations of measuring
instruments for the Primmel/OIML SMART ecosystem. Read
`docs/2026-07-26-simulated-instruments-design.md` first — it is the
founding design and carries the terminology (SMART digital twin
interface, simulated actions, the two-schema topology).

## The two laws (never violate)

1. **The epistemic wall.** `/twin` answers only what a real instrument
   could legally answer (its indication, state, served registers,
   instrument-legal operations). `/world` is the physical world
   (applied load, environment, time, ground truth). Nothing from
   `/world` may leak into `/twin` — a real instrument cannot report
   ground truth. Certification software is wired to `/twin` only.
2. **The twin interface is generated, never hand-written.** The
   `/twin` GraphQL schema is derived from the instrument's Primmel
   product reference package (serve declarations). The startup
   conformance check (schema ≡ serves ≡ promises) fails the process
   on any diff.

## Layout

- `packages/core` (@sim/core) — the framework: physics primitives,
  virtual clock, dual-schema server, twin-schema generator, console
  engine. Depends only on primmel-ts (`.prl` parsing), graphql-yoga.
- `packages/lc500` (@sim/lc500) — the simulated ACME LC-500 load cell:
  the load-cell signal chain, scenarios, process entry.
- `e2e/` — boot-the-process, drive-both-channels end-to-end tests.
- `docs/` — the design doc and any later architecture notes.

## Gates

```
npm run typecheck     # tsc, all workspaces
npm test              # vitest, all workspaces
```

Both must stay green at every commit boundary.

## Conventions

- TypeScript strict (`tsconfig.base.json`), ESM, Node ≥ 22.
- Quantity-typed physics: every physical value carries its unit; no
  bare numbers in the signal chain (the INV-1 discipline).
- Deterministic by default: manual-step virtual clock, seeded RNG.
  Wall-clock mode is opt-in.
- Dependencies: keep the footprint small and boring (graphql-yoga,
  vitest, tsx). No xterm.js, no Apollo.
