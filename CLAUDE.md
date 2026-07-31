# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

A library of **simulated measuring instruments** for the OIML SMART / Primmel
ecosystem. Each instrument is a process that serves two GraphQL channels and
mimics the real physics of its kind. Read `AGENTS.md` and
`docs/2026-07-26-simulated-instruments-design.md` first — they carry the
load-bearing terminology and the founding design. This file complements them,
it does not replace them.

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
   `packages/core/src/twin-schema.ts` from a `TwinContract` (serves +
   operations). `checkTwinConformance()` runs at every bin's startup and
   **fails the process** on any diff between schema, contract, and the upstream
   Primmel product package. Adding a served register = declaring it in the
   contract and supplying a reader in `TwinIo.registers` — generation is total
   and a declared serve with no reader throws at generation time.

## Commands

The repo is npm workspaces; everything runs from the root.

```
npm run typecheck     # tsc --noEmit across all workspaces
npm test              # vitest run across all workspaces
npm run build         # build all workspaces (incl. vite build for the bench)
```

Per-workspace:

```
npm test -w @primmel/sst-runtime                       # one workspace's vitest
npm start -w @sim/lc500                     # boot sim-lc500 on :5290
npm start -w @sim/r91                       # boot sim-r91 on :5291
npm start -w @sim/md                        # boot sim-md on :5129
npm start -w @sim/gas-analyzer              # boot sim-gas-analyzer (default port in bin)
npm run bake -w @sim/lc500                  # regenerate twin/lc500.twin.json from the product package
npx vite build                              # build the bench SPA (run from packages/lc500/bench)
```

Running a single test file or test name (vitest):

```
npx tsx --test …                            # not used; this repo uses vitest
npx vitest run packages/core/src/time.test.ts
npx vitest run -t "boots zero-SMART"        # by test name
```

Node ≥ 22 (CI matrix is 22 and 24). TypeScript is strict
(`tsconfig.base.json`: `strict`, `noUncheckedIndexedAccess`,
`exactOptionalPropertyTypes`). ESM throughout — every relative import ends in
`.js` (the NodeNext convention for `.ts` sources).

Both gates (`typecheck`, `test`) must stay green at every commit boundary.

## Branches

Working branch is **`v1`** (the default CI push trigger and the recent rename
target from `main`). Open PRs against `v1` unless told otherwise.

## Architecture (the big picture across files)

### One framework, N instrument families

- **`packages/core` (`@primmel/sst-runtime`)** — the framework. Owns: physics stage
  interfaces (`src/physics/stages/`), the OIML D 11 environment layer
  (`src/environment/`), the deterministic virtual clock (`src/time.ts`), the
  dual-schema HTTP server (`src/server.ts`), the twin-schema generator
  (`src/twin-schema.ts`), the conformance gate (`src/conformance.ts`), the
  twin-contract bake/load helpers (`src/twin-bake.ts`), the `.prl` adapter
  (`src/twin-contract-prl.ts`, build-time only), the IOS-style console
  (`src/console/`), and the LC-500 + R 144 CGM instrument + scenario registries
  (the first two families live in core; the R 91 radar and R 129 dimensioner
  live in their own packages).
- **`packages/lc500` (`@sim/lc500`)** — instrument #1, the ACME LC-500 load
  cell (R 60). Owns its bin (`src/bin.ts`), instrument metadata, the bake
  script, and the standalone bench SPA in `bench/`. The console is wired here
  only (`--console` flag).
- **`packages/r91` (`@sim/r91`)** — instrument #3, the R 91 reference Doppler
  radar speed meter. Owns its own physics (`src/physics/`), world schema
  (`src/world.ts`), scenarios, and baked contract.
- **`packages/md` (`@sim/md`)** — instrument #4, the R 129 optical
  multi-dimensional measuring instrument. Same shape as `r91`.
- **`packages/gas-analyzer` (`@sim/gas-analyzer`)** — instrument #2, the R 144
  reference continuous gas monitor. The instrument physics lives in
  `@primmel/sst-runtime` (`gas-instrument.ts`, `gas-world.ts`); this package owns the bin
  and instrument metadata. No console wiring yet.
- **`packages/lc500/bench` (`@sim/bench`)** — the standalone virtual-bench SPA
  (terminal + WebGL2 bench + "How it works" + paired passive dial). Built with
  vite, served by the sim at `/` when `dist/index.html` exists, also embedded
  by the SMART app at `/app/sim`. **One codebase, two hosts.**

### The bin startup contract (every family bin follows this)

1. Build a `WorldContext` (instrument + clock + `swap(def)` for `scenario()`).
2. Resolve the `TwinContract`: `--package <dir>` re-parses the live Primmel
   package via `twin-contract-prl.ts` (development posture); otherwise load the
   **baked artifact** at `packages/<family>/twin/<name>.twin.json` (standalone,
   zero-SMART posture — `primmel-ts` never imports at runtime).
3. `generateTwinSchema(contract, io)` → `checkTwinConformance(schema, contract)`
   — any diff prints the diff and `process.exit(1)`.
4. `createSimServer({ worldSchema, twinSchema, port, benchDir?, worldToken? })`.
5. The server logs the honesty line: whether `/world` mutations are guarded.

### The kind-generic `/world` builder

`buildWorldSchemaFor(ctx, kind)` in `packages/core/src/world-schema.ts` takes a
`WorldKind<I, D>` — each instrument family contributes its `GroundTruth` SDL,
its actuation mutation fields, its scenario registry, and its mutation
handlers. Core owns the shared surface (`setEnvironment`, `playProfile`,
`advanceTime`, `setClockMode`, `scenario`, `injectFault`/`clearFault`, `reset`).
`buildWorldSchema()` and `buildGasWorldSchema()` are pre-wired convenience
builders; `buildR91WorldSchema` / `buildMdWorldSchema` live in their packages.

### The `SIM_WORLD_TOKEN` guard (opt-in)

Set the env var and every `/world` **mutation** requires
`Authorization: Bearer <token>` (rejected 401 before any resolver runs; an
envelop plugin in `server.ts`, never in the physics). `/world` **queries** and
the whole `/twin` channel stay open. Unset ⇒ everything open, with a startup
log line saying so. Non-local deployments must set it.

### The bake-freshness CI job

`.github/workflows/ci.yml` has a `bake-freshness` job that re-bakes
`packages/lc500/twin/lc500.twin.json` from the private `acme-lc500` Primmel
package and diffs against the committed artifact. It **no-ops** when
`SIM_ACME_LC500` is unset (i.e. on public CI without the smart checkout) — the
check is real only where the smart checkout lives. Same pattern is implicit
for `r91`/`md` (handshake tests are skip-guarded until their packages land).

## Conventions that aren't obvious from the code

- **Quantity-typed physics (INV-1).** Every physical value carries its unit
  (`Qty` from `physics/quantity.ts`); no bare numbers in the signal chain.
- **Deterministic by default.** The virtual clock is manual-step
  (`advanceTime(seconds)`); wall-clock mode is opt-in. RNG is seeded
  (`mulberry32`) so golden trajectories are reproducible.
- **Small, boring dependency footprint.** `graphql`, `graphql-yoga`, `vitest`,
  `tsx`. No xterm.js, no Apollo. `primmel-ts` is a **build-time-only** dep
  (devDependency of `@primmel/sst-runtime`); runtime boots from the baked JSON.
- **Adding a new instrument family.** New package under `packages/<name>/`;
  contribute its `WorldKind`; supply a `TwinContract` (in core or in the
  package); ship a baked artifact under `twin/`; write a bin following the
  startup contract above. The LC500 family is the reference implementation.
- **Console grammar is load-cell-shaped.** `core/src/console/grammar.ts`
  parses load-cell actuation (`place load`, `remove load`, …). Other families
  drive via `/world` directly — do not extend the grammar for them; the design
  defers that.
- **Tests live next to sources** (`*.test.ts`). Vitest config in each
  workspace picks up `**/*.test.ts`. The `bin.test.ts` files spawn the actual
  bin via `tsx` and exercise both channels over HTTP — they are the
  end-to-end legs.
- **The `e2e/` directory is empty** (a placeholder for the spec's §12 plan);
  end-to-end coverage currently lives in each package's `bin.test.ts`.
