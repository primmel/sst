# SST TwinDriver + WorldDriver — the client API library

> **Status:** normative. Implementation: `packages/runtime/sst-runtime/src/twin/` and `src/world/`.

The platform generates the server-side twin schema from the `TwinContract` (`generateTwinSchema`); it generates the **client-side** twin driver from the same contract (`createTwinDriver`). The same model-driven thesis applies to the world schema: the kind's `world-kind.yaml` drives both the server-side world schema and the client-side `WorldDriver`.

Together these close the loop: the contract is the source of truth on both sides. Consumers (the bench, the SMART app's gateway connector, certification engines, tests) talk to a running instrument via typed methods, never raw GraphQL strings.

## The TwinDriver

```ts
import type { TwinContract } from '@primmel/sst-runtime/twin-contract'
import { createTwinDriver, type TwinDriver } from '@primmel/sst-runtime/twin/driver'

const driver = createTwinDriver(LC500_CONTRACT, 'http://localhost:5290')

// Read methods (one per `serve` whose via-operation is `query` or `watch`)
const ind = await driver.indication()         // → ServedQuantity
const st  = await driver.state()              // → string

// Subscribe methods (one per `serve` whose via-operation is `watch`)
for await (const s of driver.subscribeState()) { console.log(s) }

// Invoke methods (one per `operation` of kind `command`)
const result = await driver.runSelfTest()     // → OpResult
```

### Method-name mapping

| Contract declaration | Driver method | Return type |
|---|---|
| `serve indication via get_indication fresh_within 5s` (query) | `indication()` | `Promise<ServedQuantity>` |
| `serve state via watch_state fresh_within 1s` (watch) | `state()` + `subscribeState()` | `Promise<string>` + `AsyncIterableIterator<string>` |
| `serve environmental_context via watch_op_state` (watch) | `environmentalContext()` + `subscribeEnvironmentalContext()` | `Promise<Environment>` + `AsyncIterableIterator<Environment>` |
| `operation run_self_test (command)` | `runSelfTest()` | `Promise<OpResult>` |
| `serve indication_co via get_indication_co` (query, non-core target) | `indicationCo()` | `Promise<ServedQuantity>` |

Method names: `snakeToCamel(serve.target)` (with `environmental_context` → `environmentalContext`).

### Freshness enforcement

Each serve carries `freshWithinS`. The driver:
- Exposes `driver.freshness.<target>` for callers to read.
- Optionally warns or throws (via `DriverOpts.onStale`) when `Date.now()/1000 - response.servedAt > freshWithinS`. This catches the `stale-twin` damage scenario.

### Subscription transport

The driver uses the Fetch API's streaming response body (or `EventSource` fallback) to consume the server's SSE stream. The async-iterator protocol matches the server's `watchStream` (`packages/core/src/twin-schema.ts:144`). No RxJS, no new abstraction.

### The shared `gql()` transport

The driver owns the GraphQL POST helper (`packages/runtime/sst-runtime/src/twin/transport.ts`). The 5+ duplicated `gql()` functions across the bench + per-family tests collapse into one. The same transport is shared with the WorldDriver.

## The WorldDriver

```ts
import { createWorldDriver, type WorldDriver } from '@primmel/sst-runtime/world/driver'

const world = createWorldDriver('http://localhost:5290', {}, {
  placeLoad: 'massKg: Float',
  removeLoad: '',
  setFidelity: 'servedOffsetKg: Float, servedLagS: Float',
  fidelityReset: '',
  setThermalHysteresis: 'perDegC: Float, tauS: Float',
})

// Base reads (shared by every kind):
const gt = await world.groundTruth()
const t  = await world.clock()
const sc = await world.scenarios()
const pr = await world.profiles()

// Base mutations (shared by every kind):
await world.setEnvironment({ temperatureDegC: 60 })
await world.playProfile('damp-heat-cyclic-db')
await world.advanceTime(300)
await world.setClockMode('manual')
await world.scenario('creep-cell')
await world.injectFault()
await world.clearFault()
await world.reset()

// Kind-specific mutations (one method per entry in world-kind.yaml):
await world.placeLoad(40)                     // → WorldState
await world.removeLoad()                      // → WorldState
await world.setFidelity({ servedOffsetKg: 0.25 })
```

### Why a separate driver

The `/twin` and `/world` endpoints are kept strictly separate per the epistemic wall (the central architectural law). Two drivers mirror that topology. The `SceneContext` (see `11-scene-context.md`) carries both; the instance's `scene.ts` decides which to call for each gesture.

## Per-kind driver surfaces

| Kind | TwinDriver reads | TwinDriver subscribes | TwinDriver invokes | WorldDriver kind mutations |
|---|---|---|---|---|
| R 60 (load cell) | `indication`, `state` | `subscribeState` | `runSelfTest` | `placeLoad`, `removeLoad`, `setFidelity`, `fidelityReset`, `setThermalHysteresis` |
| R 144 (gas analyzer) | `indicationCo`, `indicationNox`, `state`, `environmentalContext` | `subscribeState`, `subscribeEnvironmentalContext` | `zeroCalibration`, `spanCalibration`, `runSelfCheck` | `setGasConcentration`, `setNo2Fraction`, `setInterferents`, `setSampleFlow`, `setOpticsContamination`, `setSourceAgingRate`, `setSampleLineLeak` |
| R 91 (radar) | `indication`, `state`, `environmentalContext` | `subscribeState`, `subscribeEnvironmentalContext` | `runSelfTest` | `setTarget`, `clearTarget`, `setRain`, `setVibration`, `setEmi`, `setOscillatorDrift`, `setAntennaMisalignment`, `setInterferenceSource`, `clearInterferenceSource`, `driveProfile`, `stopProfile` |
| R 129 (dimensioner) | `indicationLength`, `indicationWidth`, `indicationHeight`, `dimVolume`, `dimWeight`, `state`, `environmentalContext` | `subscribeState`, `subscribeEnvironmentalContext` | `runSelfTest` | `setConveyorSpeed`, `feedObject`, `clearObject`, `setAmbientLight`, `setEmi`, `setBeamOccluded`, `setEncoderSlip`, `setScannerTilt`, `setThermalResidual`, `driveFeed`, `stopFeed` |

## Why this matters

The platform's central promise is **fully model-driven**: the contract is the source of truth. Today that's true on the server (the schema is generated) but not on the client (consumers hand-write query strings). The TwinDriver and WorldDriver make both sides generated:

1. The server's GraphQL schema + resolvers (`generateTwinSchema`).
2. The client's typed method surface (`createTwinDriver` / `createWorldDriver`).

A change to the contract propagates to both at compile time. Drift becomes impossible.

## Status

- ✅ Spec (this document).
- 🟡 Implementation: scaffolded at `packages/runtime/sst-runtime/src/twin/driver.ts` and `src/world/driver.ts`. The driver is functional; the type-level mapping (so each contract produces a statically-typed driver surface without dynamic method injection) lands in TODO 02's full execution.
- ⬜ Migration: the bench's `api.ts`, the per-family `bin.test.ts` files, the console's `client.ts`, and the SMART app's gateway connector all swap their hand-rolled helpers for the driver (TODO 02 + TODO 08).
