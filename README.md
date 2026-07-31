# Primmel SST — the Simulated SMART Twin platform

A **plug-and-play simulator** for OIML measuring instruments. Each
instrument kind lives in a self-describing **Primmel SST package** —
open the UI, upload a package (a ZIP of YAML + a 3D model + bundled
behavior), the sim runs.

> **Where am I?** This repo is the SST platform of the Primmel/OIML
> SMART ecosystem. The SMART app embeds the bench via iframe; the
> doctrine background is at
> [primmel-oiml-smart](https://www.primmel.org/primmel-oiml-smart/).

## What it is

The platform composes **five tiers**:

| Tier | Owner | Example |
|---|---|---|
| **base** | OIML D 11 environmental conditions (passive) | `packages/base/sst-oiml-base/` |
| **kind** | one OIML Recommendation (R 60, R 91, R 129, R 144, …) | `packages/kinds/sst-r60/` |
| **instance** | one manufacturer/model (ACME LC-500, …) | `packages/instances/acme-lc500/` |
| **runtime** | the kind-agnostic loader (TODO 02) | `packages/runtime/sst-runtime/` |
| **shell** | the web UI host (TODO 03) | `packages/shell/sst-shell/` |

**Composition rule**: one instance → one kind → one base. Adding
instances / kinds / base updates is **additive** at each tier — zero
cross-tier edits. See `specs/07-ocp-patterns.md` and
`specs/08-additive-extension.md` for the cookbook.

## Status

- **Phase 1 (base)** — D 11 Ed 13 conditions: 36/35 done (canonical
  set + one synonym) under `packages/base/sst-oiml-base/conditions/`,
  plus 3 canonical chamber profiles.
- **Phase 2a (R 60 kind)** — fully authored:
  classification/parameters/mpe/physics-chain/world-kind SDL+binding/
  bench.yaml/interface.d.ts/scenarios.
- **Phase 2b (ACME LC-500 instance)** — fully authored: manifest,
  coefficients, 8 sample variants (fresh + 7 damaged), behavior source
  + placeholder bundle, model stub.
- **Phase 8 (sibling kinds)** — fully authored: `sst-r91` (radar),
  `sst-r129` (dimensioner), `sst-r144` (gas analyzer) — each carries
  the same 10-file set as `sst-r60`. Sibling instances are stubs
  pending TODO 07's instance-side completion.
- **Phase 3 (runtime)** — pending (TODO 02). Spec at `specs/05-runtime.md`.
- **Phase 4 (shell)** — pending (TODO 03). Spec at `specs/06-shell.md`.
- **Phases 5-9** — pending. See `TODO.complete/` for the full workstream plan.

The legacy pre-SST packages (`packages/{core,lc500,r91,md,gas-analyzer}/`)
keep working during the migration window. Phase 9 (`@sim/*` →
`@primmel/sst-*` rename) folds them into the SST packages.

## Quickstart (today, pre-runtime)

The runtime (TODO 02) is not yet wired up — the bench SPA still boots
via the legacy `sim-lc500` bin:

```bash
git clone …
cd sim-instruments
npm install
npm start -w @sim/lc500                 # boots the LC-500 sim on :5290
# → open http://localhost:5290/
```

After TODO 02 lands, the entry point becomes `primmel-sst run acme-lc500`.

## Documentation map

- **Architecture** — `specs/00-architecture.md` (the five-tier diagram
  + the composition rule).
- **Package format** — `specs/01-package-format.md` (the manifest schema)
  and `specs/schemas/package-manifest.schema.json` (normative).
- **Tier specs** — `specs/02-base-package.md`, `specs/03-kind-package.md`,
  `specs/04-instance-package.md`.
- **Runtime + shell** — `specs/05-runtime.md`, `specs/06-shell.md`.
- **Pattern library** — `specs/07-ocp-patterns.md`.
- **Cookbook** — `specs/08-additive-extension.md` (how to add a kind,
  an instance, a condition, a stage).
- **Design decisions** — `specs/09-design-decisions.md` (the ADR log).
- **Workstream plan** — `TODO.complete/README.md` (every remaining
  phase, with priority + status + dependencies).
- **Packages directory** — `packages/README.md` (the tier grouping).

## Repository layout

```
sim-instruments/
  README.md                     this file
  AGENTS.md                     agent guidance
  CLAUDE.md                     Claude Code orientation
  packages/
    README.md                   the tier-grouping map
    base/                       Tier 1 — D 11 base packages
      sst-oiml-base/
    kinds/                      Tier 2 — OIML SST kind packages
      sst-r60/                  (fully authored — load cells, R 60)
      sst-r91/                  (fully authored — radar speed meters, R 91)
      sst-r129/                 (fully authored — dimensioners, R 129)
      sst-r144/                 (fully authored — gas monitors, R 144)
    instances/                  Tier 3 — Primmel SST instance packages
      acme-lc500/               (fully authored)
      acme-rs180/, acme-md3xx/, acme-cgm-200/   (stubs — TODO 07)
    runtime/                    Phase 3 — pending
    shell/                      Phase 4 — pending
    core/, lc500/, r91/, md/, gas-analyzer/   (legacy pre-SST, kept during migration)
  specs/                        the formal specs + JSON Schemas
  TODO.complete/                the workstream plan (one file per phase)
  docs/                         the founding design doc + addenda
```

## License

TBD (the OIML SMART program's licensing decision applies).
