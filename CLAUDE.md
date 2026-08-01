# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is (v2)

The **Primmel SST** platform — a model-driven, plug-and-play simulator for
OIML measuring instruments. Each instrument kind lives in a self-describing
package (YAML data + a bundled `behavior.js` + a 3D model); the runtime
composes them into a running session. Read `AGENTS.md` and
`docs/2026-07-26-simulated-instruments-design.md` first — they carry the
founding design. This file complements them, it does not replace them.

## The two laws (never violate)

1. **The epistemic wall.** `/twin` answers only what a real instrument could
   legally answer (indication, state, served registers, instrument-legal
   operations). `/world` is the physical world (applied load, environment,
   time, ground truth). **Nothing from `/world` may leak into `/twin`** —
   `groundTruth()` and `indication()/servedAt()/operationalState()` live on the
   same object by composition, not by data sharing. Certification software is
   wired to `/twin` only; the discipline is enforced by topology (two schemas,
   two endpoints), not by convention.
2. **The `/twin` schema is generated, never hand-written.** The schema is
   produced by `generateTwinSchema(contract, io)` in
   `packages/runtime/sst-runtime/src/twin-schema.ts` from a `TwinContract`
   (serves + operations). `checkTwinConformance()` runs at every boot and
   **fails the process** on any diff between schema, contract, and the
   upstream Primmel product package. Adding a served register = declaring it
   in the contract and supplying a reader in `TwinIo.registers` — generation
   is total and a declared serve with no reader throws at generation time.

## Commands

The repo is npm workspaces; everything runs from the root.

```
npm run typecheck     # tsc --noEmit across all workspaces
npm test              # vitest run across all workspaces
npm run build         # build all workspaces (incl. astro build for the bench)
```

Per-workspace:

```
npm test -w @primmel/sst-runtime                # one workspace's vitest
npx tsx packages/runtime/sst-runtime/src/bin.ts run packages/instances/acme-lc500 5290
                                                 # boot any instance via the universal CLI
npx tsx packages/kinds/sst-r60/scripts/bake.ts  # regenerate twin/r60.twin.json from the product package
npx astro build                                  # build the bench SPA (run from packages/shell/sst-bench)
```

Running a single test file or test name (vitest):

```
npx vitest run packages/runtime/sst-runtime/src/time.test.ts
npx vitest run -t "boots zero-SMART"             # by test name
```

Node ≥ 22 (CI matrix is 22 and 24). TypeScript is strict
(`tsconfig.base.json`: `strict`, `noUncheckedIndexedAccess`,
`exactOptionalPropertyTypes`). ESM throughout — every relative import ends in
`.js` (the NodeNext convention for `.ts` sources).

Both gates (`typecheck`, `test`) must stay green at every commit boundary.

## Branches

Working branch is **`v2`** (the no-legacy architecture; v1 is preserved as
the pre-deletion reference). Open PRs against `v2` unless told otherwise.

## Architecture (the big picture across files)

### Five tiers, one universal boot path

- **`packages/base/sst-oiml-base/`** — the OIML D 11 environmental base
  (35 condition classes, severity tables, time-program profiles). Shared
  by every kind.
- **`packages/kinds/sst-{r60,r91,r129,r144}/`** — the kind packages.
  Each carries data only: classification axes, the MPE envelope, the
  active-domain /world SDL + handlers binding, the physics-chain
  template, the bench metadata, the kind's interface.d.ts (the contract
  every instance's behavior.js must satisfy), scenarios, and the baked
  twin contract at `twin/<id>.twin.json`.
- **`packages/instances/<id>/`** — the instance packages. Each carries
  `package.sst.yaml` (manifest), `coefficients.yaml`, `behavior.js`
  (bundled `behavior.ts` + `scene.ts` — the physics + 3D bindings),
  `samples/*.yaml`, and `model.glb`.
- **`packages/runtime/sst-runtime/` (`@primmel/sst-runtime`)** — the
  framework. Kind-agnostic. Owns: physics stages (the shared library),
  the OIML D 11 environment layer, the deterministic virtual clock, the
  dual-schema HTTP server, the twin-schema generator, the conformance
  gate, the twin-contract bake/load helpers, the `.prl` adapter
  (build-time only), the console, the typed TwinDriver/WorldDriver, and
  the universal plug-and-play boot path (`tryBootFromBehavior`).
- **`packages/shell/`** — `sst-shell` (the gallery/upload/session-tabs
  Astro host) + `sst-bench` (the standalone virtual-bench SPA — moved
  here from `packages/lc500/bench/` in v2). One codebase, two hosts:
  served by the sim at `/` when `dist/index.html` exists, also embedded
  by the SMART app at `/app/sim`.

### The universal boot (no per-kind dispatch)

`runSession(instance, opts)` in
`packages/runtime/sst-runtime/src/session/boot.ts`:

1. Resolve the instance's classification + coefficients.
2. Resolve the kind directory; load `physics-chain.yaml` if present.
3. **Universal plug-and-play:** `tryBootFromBehavior` loads the
   instance's `behavior.js`, validates it has the TwinInstrumentView
   surface (`indication`, `servedAt`, `operationalState`), calls
   `behavior.create(def, clock, seed)`, and assembles the /world
   schema from the kind's `world-kind.{sdl.graphql,yaml}` + `handlers.ts`.
   No `KIND_BOOT_REGISTRY`. No per-kind dispatch. The behavior.js IS
   the physics; there is no fallback.
4. Load the kind's baked twin contract, enrich with the full
   `InstrumentModel` from the instance manifest + the kind's `mpe.yaml`.
5. `generateTwinSchema(contract, twinIo)` → `checkTwinConformance()`
   fails the process on any drift.
6. `createSimServer({ worldSchema, twinSchema, port, twinStream, … })`
   and boot.

Adding a new kind = author a kind package (data) + bake its twin
contract + author at least one instance package with a `behavior.js`
that satisfies the kind's `interface.d.ts`. **Zero runtime edits.**

### The `SIM_WORLD_TOKEN` guard (opt-in)

Set the env var and every `/world` **mutation** requires
`Authorization: Bearer <token>` (rejected 401 before any resolver runs;
an envelop plugin in `server.ts`, never in the physics). `/world`
**queries** and the whole `/twin` channel stay open. Unset ⇒ everything
open, with a startup log line saying so. Non-local deployments must set
it.

### The bake-freshness CI job

`.github/workflows/ci.yml` has a `bake-freshness` job that re-bakes
`packages/kinds/sst-r60/twin/r60.twin.json` from the private `acme-lc500`
Primmel package and diffs against the committed artifact. It **no-ops**
when `SIM_ACME_LC500` is unset (i.e. on public CI without the smart
checkout) — the check is real only where the smart checkout lives.

## Conventions that aren't obvious from the code

- **Quantity-typed physics (INV-1).** Every physical value carries its
  unit (`Qty` from `physics/quantity.ts`); no bare numbers in the signal
  chain.
- **Deterministic by default.** The virtual clock is manual-step
  (`advanceTime(seconds)`); wall-clock mode is opt-in. RNG is seeded
  (`mulberry32`) so golden trajectories are reproducible.
- **Self-ticking instruments.** A physics class that wants clock-driven
  state subscribes in its constructor via `clock.onAdvance(dt =>
  this.tick(dt))` — see `instrument.ts`, `gas-instrument.ts`,
  `stages/composer.ts`. Tick on every advance, never on read.
- **Small, boring dependency footprint.** `graphql`, `graphql-yoga`,
  `vitest`, `tsx`. No xterm.js, no Apollo. `primmel-ts` is a
  **build-time-only** dep (devDependency of `@primmel/sst-runtime`);
  runtime boots from the baked JSON.
- **Adding a new instrument kind.** New kind package under
  `packages/kinds/sst-<id>/` (data + interface.d.ts + twin contract
  bake); new instance package under `packages/instances/<id>/` with
  `behavior.js` implementing the kind's interface.d.ts. Zero code in
  the runtime. The sst-r60 + acme-lc500 pair is the reference.
- **Console grammar is load-cell-shaped.**
  `packages/runtime/sst-runtime/src/console/grammar.ts` parses
  load-cell actuation (`place load`, `remove load`, …). Other kinds
  drive via `/world` directly — do not extend the grammar for them;
  the design defers that.
- **Tests live next to sources** (`*.test.ts`). Vitest config in each
  workspace picks up `**/*.test.ts`. The runtime's tests boot sessions
  in-process and exercise both channels — they are the end-to-end legs.
- **v2 deleted the legacy family packages.**
  `packages/{lc500,r91,md,gas-analyzer}/` no longer exist; their
  physics is inlined into the instance `behavior.js` files (rs180,
  md3xx) or imported from the runtime's shared library (lc500, cgm-200).
  The smart side's `sim-bin` resolver points every family at the
  sst-runtime CLI exclusively.
