# Primmel SST — the Simulated SMART Twin framework

The **kind-agnostic runtime** for simulated SMART twins: a plug-and-play
simulator where an instrument is a self-describing **Primmel SST
package** (YAML + a 3D model + bundled behavior) — boot it, and the
twin serves the same `/twin` interface a real SMART-twin-capable
instrument would, plus a `/world` channel for the physics a lab would
apply.

> **The split (TODO.integration/24):** this repo is the **framework**
> (program-agnostic). The instrument packages live in
> **[oimlsmart/sst-instruments](https://github.com/oimlsmart/sst-instruments)**.
> The pre-split repo `oimlsmart/sim-instruments` is archived.
> The doctrine background is the
> [platform volume](https://primmel.github.io/primmel-smart-docs/platform/)
> of the Primmel SMART documentation federation.

## What it is

| Piece | Path | What |
|---|---|---|
| **runtime** | `packages/runtime/sst-runtime` | the kind-agnostic loader + server (`/twin`, `/world`, the bench) |
| **gltf** | `packages/runtime/sst-gltf` | the 3D-model pipeline helpers |
| **shell** | `packages/shell/sst-shell` | the web UI host |
| **bench** | `packages/shell/sst-bench` | the bench SPA (drive the sim in a browser) |
| **specs** | `specs/` | the normative spec set (00–13: architecture, package format, runtime, composite sessions, …) |

The runtime **composes** a base + kind + instance package into a
running sim — the packages themselves live in the instrument library;
composition is additive (a new kind or instance is a new package,
never a runtime edit).

## Quick start

```bash
npm install

# Boot an instrument from the library (the sibling checkout layout:
# primmel/sst next to oimlsmart/sst-instruments; or set SST_LIBRARY_PATH):
npx tsx packages/runtime/sst-runtime/src/bin.ts run \
  ../sst-instruments/packages/instances/acme-lc500 5290

# …or the Cisco-IOS-style console:
npx tsx packages/runtime/sst-runtime/src/bin.ts run \
  ../sst-instruments/packages/instances/acme-lc500 5290 --console
```

The twin answers at `http://localhost:5290/twin` (GraphQL), the world
drives at `/world`, the bench at `/`.

```graphql
# the legal view
{ indication { value unit servedAt } state }
# drive the physics
mutation { placeLoad(massKg: 500) { clock } }
mutation { advanceTime(seconds: 60) { clock } }
```

## The composite session

A *system* of instruments boots as one session — components behind one
composite `/twin` (serves decomposed per component, `/world` fanned
out per component, the composite state rule computed server-side).
Spec: [`specs/13-composite-session.md`](specs/13-composite-session.md);
the canonical example is the ACME CGM-200 system in the instrument
library.

## Repository layout and the library seam

The runtime finds the instrument library via
[`src/library-paths.ts`](packages/runtime/sst-runtime/src/library-paths.ts):
`SST_LIBRARY_PATH` wins, then the sibling checkout
(`../sst-instruments`), then in-repo. The instruments repo declares
its dependency on this package with a sibling `file:` link during
development; the npm tag follows at release.

Tests: `npm test` (the runtime suite). The boundary rule (framework
never imports instrument content) is proven by
`smart/scripts/sst-split/check-boundary.sh`.

## License

Proprietary — OIML SMART pilot (see the program site,
[oimlsmart.org](https://www.oimlsmart.org)).
