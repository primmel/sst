# AGENTS.md — Primmel SST (Simulated SMART Twin)

Guidance for agent sessions working in this repository. **Read the
specs first** (`specs/00-architecture.md`); the architecture is the
contract.

## What this repo is

The Primmel SST platform — a plug-and-play simulator for OIML
measuring instruments. Five tiers compose: base (D 11 conditions),
kind (per OIML Recommendation), instance (per manufacturer/model),
runtime (the kind-agnostic loader), shell (the web UI host).

The legacy pre-SST packages (`packages/{core,lc500,r91,md,gas-analyzer}/`)
are kept during the migration window. New work goes into the tier
subdirectories under `packages/`.

## The two laws (never violate)

1. **The epistemic wall.** `/twin` answers only what a real instrument
   could legally answer. `/world` is the physical world (loads, gas,
   radar targets, environment, time). **Nothing from `/world` may leak
   into `/twin`.** A real instrument cannot report ground truth.
   Certification software is wired to `/twin` only; the discipline is
   enforced by topology (two schemas, two endpoints).

2. **Each tier is closed for modification.** Adding things is fine —
   adding a kind, an instance, a D 11 condition, a physics stage. **Editing
   existing tier members is a code smell.** See `specs/07-ocp-patterns.md`
   and `specs/08-additive-extension.md`.

## Layout

- `packages/base/sst-oiml-base/` (Tier 1) — D 11 conditions
  (climatic, mechanical, EMC, vehicle-supply), each as one YAML file
  under `conditions/`; canonical chamber time-programs under `profiles/`.

- `packages/kinds/sst-r{60,91,129,144}/` (Tier 2) — kind packages
  (one per OIML Recommendation). Each has the same 10-file shape:
  `package.sst.yaml`, `classification.yaml`, `parameters.yaml`,
  `mpe.yaml`, `physics-chain.yaml`, `world-kind.sdl.graphql`,
  `world-kind.yaml`, `bench.yaml`, `interface.d.ts`, `scenarios.yaml`.

- `packages/instances/acme-{lc500,rs180,md3xx,cgm-200}/` (Tier 3) —
  instance packages. Each has the same shape: `package.sst.yaml`,
  `coefficients.yaml`, `samples/*.yaml`, `src/behavior.ts` (source),
  `behavior.js` (bundled), `model.glb` (3D artifact).

- `packages/runtime/sst-runtime/` (Tier 4 — TODO 02 pending) — the
  loader. Composes the three tiers into a running sim.

- `packages/shell/sst-shell/` (Tier 5 — TODO 03 pending) — the web UI
  host. 2-step drill-down: kinds gallery → instances → session view.

- `packages/{core,lc500,r91,md,gas-analyzer}/` — legacy pre-SST.
  `core` is the runtime-to-be; the family packages will fold into the
  SST tier subdirectories in Phase 9.

- `specs/` — formal specs + JSON Schemas. **Normative.** Code
  conforms to specs; specs don't conform to code.

- `TODO.complete/` — the workstream plan. One file per phase; the
  README is the master index with priorities and dependencies.

## Gates

```
npm run typecheck     # tsc --noEmit / astro check, all workspaces
npm test              # vitest run, all workspaces
```

Both must stay green at every commit boundary. When the runtime lands
(TODO 02), the typecheck adds schema validation for every loaded
package.

## Conventions

- TypeScript strict (`tsconfig.base.json`), ESM, Node ≥ 22.
- **Quantity-typed physics** — every physical value carries its unit;
  no bare numbers in the signal chain (INV-1 discipline).
- **Deterministic by default** — manual-step virtual clock, seeded RNG.
  Wall-clock mode is opt-in.
- **No doubles in tests** — real model instances only. If a model is
  hard to set up, build a test factory; don't reach for `double()`.
- **No hand-rolled serialization** — the SST package's YAML IS the
  wire form; no `to_h`/`from_h` methods anywhere.
- **No `as any`** — proper TypeScript types throughout.
- **No AI attribution** in commits or PRs.
- **No `--no-verify`** — fix the cause, not the symptom.
- **NEVER DELETE source files.** Per the global rule. Flag for
  confirmation instead.

## When in doubt

- Read `specs/`. The specs are the contract.
- If a change touches more than one tier, it's probably wrong — see
  `specs/07-ocp-patterns.md` for the discipline.
- If you find a new kind of cross-cutting concern, ask: which tier
  owns it? (Per MECE — see `specs/00-architecture.md`.) If no tier
  owns it, the architecture has a gap; flag for an ADR
  (`specs/09-design-decisions.md`).
- If you find yourself wanting to edit existing tier members, stop.
  Use the additive recipes in `specs/08-additive-extension.md`.

## Where to look first

- The plan: `TODO.complete/README.md`
- The architecture: `specs/00-architecture.md`
- The package format: `specs/01-package-format.md`
- A worked example: `packages/kinds/sst-r60/` (the canonical kind)
  paired with `packages/instances/acme-lc500/` (the canonical instance)
