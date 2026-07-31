# 12. The External GraphQL API — model-driven, contract-generated

> **Status:** normative. Implementation: `packages/core/src/twin-schema.ts` (server-side generator), `packages/runtime/sst-runtime/src/twin/` (client-side driver), `packages/runtime/sst-runtime/src/session/boot.ts` (the running server).

The API is **not hand-written**. It is **generated from the Primmel instrument model** (the `.prl` product package), which itself mirrors the OIML Recommendation's full instrument model. The digital twin **is** the Recommendation's instrument model in digital form — its hierarchy (classification, design parameters, metrological limits), its properties (e_max, v_min, n_lc, accuracy class, …), and its behavior (served registers, legal operations). The runtime compiles the model into a GraphQL schema that **mirrors the model's structure exactly**. The schema is the API. If the model changes, the API changes — no code edits, no separate API definition to keep in sync.

This is the **fully model-driven** thesis, taken to its conclusion: the OIML Recommendation defines the instrument model; the Primmel `.prl` package implements that model digitally; the digital twin's GraphQL interface mirrors the model. A running server's `/twin` endpoint exposes exactly and only what its model declares — at every level of the hierarchy — and a startup conformance check (`checkTwinConformance`) fails the process if the served schema drifts from the model.

**The twin is not a flat projection of `serve` declarations.** The serves (indication, state, environmental_context, …) and operations (run_self_test, …) are leaves of the model — the served register surface and the legal-operation surface. They sit alongside the model's identification, classification, design parameters, metrological limits, and provenance, all of which are exposed as nested GraphQL types. The flat `Query.indication` shortcuts exist for convenience; the canonical access is `Query.instrument { servedRegisters { ... } }`.

## 1. The model → API chain

```
OIML Recommendation (R 60 / R 144 / R 91 / R 129)
        ↓ informs
Primmel instrument model (.prl product package)
        ↓ parsed by twin-contract-prl.ts →
TwinContract (serves + operations)
        ↓ generateTwinSchema(contract, io) →
GraphQL schema (Query + Mutation + Subscription)
        ↓ served at /twin by createSimServer →
The wire API (HTTP POST + SSE)
        ↓ createTwinDriver(contract, url) →
Typed TypeScript client (TwinDriver<C>)
```

A change at any link propagates downward automatically. A change at the model propagates to the API and the typed client at the next compile/startup. There is **no manual synchronisation step** and **no backwards-compatibility shim** — the model IS the API. Clients re-introspect after a model update.

This document specifies:
- The **invariants** — types and shapes present in every model-generated `/twin` API.
- The **generation rules** — how each kind of model declaration becomes a schema element.
- The **wire format** — request/response shapes, SSE protocol, auth.
- The **discovery** — how a client learns what a specific instrument's API exposes.
- The **typed client** — `TwinDriver<C>`, whose method surface is derived from the contract type at compile time.

This document does NOT enumerate a static field list. Such a list would be a lie: the fields are whatever the model declares.

## 2. Endpoints

| Path | Method | Purpose |
|---|---|---|
| `/twin` | POST | GraphQL query/mutation against the **model-generated** twin schema |
| `/twin` | POST (`accept: text/event-stream`) | GraphQL subscription (watch-kind serves) |
| `/twin/stream` | GET | **Real-time SSE** — continuous twin monitoring (one event per clock advance) |
| `/twin` | GET | GraphiQL playground (interactive schema exploration) |
| `/twin` | POST (`accept: text/event-stream`) | GraphQL subscription (watch-kind serves) |
| `/twin` | GET | GraphiQL playground (interactive schema exploration) |
| `/world` | POST | GraphQL query/mutation against the **kind-driven** world schema |
| `/world` | GET | GraphiQL playground |
| `/` | GET | Landing page or embedded bench (the @sim/bench SPA build output) |

`/twin` and `/world` are kept strictly separate (the **epistemic wall**, the central architectural law #1). The model-driven-ness applies only to `/twin`. `/world` is kind-driven — the kind's `world-kind.yaml` declares the mutations, layered on top of the runtime's fixed base surface.

`SIM_WORLD_TOKEN` env var, when set, requires `Authorization: Bearer <token>` on every `/world` mutation (see §5.3). `/twin` is always open.

## 3. The `/twin` channel — model-driven

### 3.1 How the model becomes the schema

The `.prl` product package contains `serve` declarations:

```
serve indication via get_indication fresh_within 5s
serve state via watch_state fresh_within 1s
operation run_self_test (command)
```

`twin-contract-prl.ts` parses these into a `TwinContract`:

```ts
{
  instrumentId: 'acme-lc500',
  serves: [
    { target: 'indication', via: 'get_indication', freshWithinS: 5 },
    { target: 'state', via: 'watch_state', freshWithinS: 1 },
  ],
  operations: [
    { id: 'get_indication', kind: 'query' },
    { id: 'watch_state', kind: 'watch' },
    { id: 'run_self_test', kind: 'command' },
  ],
}
```

`generateTwinSchema(contract, io)` compiles this into SDL:

```graphql
type Query { indication: ServedQuantity! state: String! }
type Mutation { runSelfTest: OpResult! }
type Subscription { state: String! }
```

Notice that `state` (served via a `watch` operation) appears in **both** `Query` and `Subscription` — clients can poll or subscribe.

### 3.2 The invariant types (always present)

Regardless of which Primmel model generated the schema, these types are always defined:

```graphql
type ServedQuantity {
  value: Float!
  unit: String!               # a BIPM Digital SI Framework URI (see specs §12 §3.8)
  kind: String!
  servedAt: Float!            # epoch seconds
}

type Environment {
  temperatureDegC: Float!
  humidityPercentRh: Float!
  pressureKPa: Float!
}

type OpResult {
  state: String!              # the operational state after the operation ran
}

type Quantity {                # a typed property of the model
  value: Float!
  unit: String!               # BIPM Digital SI Framework URI
}
```

### 3.3 The full-model mirror — `Query.instrument`

The twin's canonical access is `Query.instrument`, which exposes the **full instrument model** as nested GraphQL types. This is the digital twin: the Recommendation's model, in digital form, served.

```graphql
type Query {
  instrument: InstrumentModel!         # the full model — the digital twin
  indication: ServedQuantity!          # flat shortcut (R 60 only)
  state: String!                       # flat shortcut (R 60 only)
  environmentalContext: Environment!   # flat shortcut (R 144 only)
}

type InstrumentModel {
  identification: InstrumentIdentification!
  classification: Classification!              # kind-specific axes
  designParameters: DesignParameters!          # e_max, e_min, v_min, n_lc, …
  metrologicalLimits: MetrologicalLimits       # MPE, repeatability, creep, …
  provenance: Provenance                       # certificate, first_issued
  servedRegisters: [ServedRegisterInfo!]!      # the leaves — what the twin serves
  legalOperations: [LegalOperationInfo!]!      # the leaves — instrument-legal ops
}

type InstrumentIdentification {
  instrumentId: String!          # the canonical id (e.g. 'acme-lc500')
  manufacturer: String
  model: String
  serial: String
  designation: String            # the full commercial designation
  kindId: String                 # the OIML kind (e.g. 'primmel-sst-r60')
  oimlRecommendation: String     # e.g. 'OIML R 60'
}

type Classification {
  # R 60 axes (other kinds declare their own):
  accuracyClass: String          # 'A' | 'B' | 'C' | 'D'
  humidityClass: String          # 'CH' | 'SH'
  loadType: String               # 'tension' | 'compression' | 'universal'
  construction: String           # 'column' | 'canister' | 'shear-beam' | …
  technology: String             # 'strain-gauge' | …
  nLc: Int                       # number of verification intervals
}

type DesignParameters {
  # Each property carries a value + a BIPM Digital SI Framework URI for the unit.
  eMax: Quantity                 # Maximum measuring range (load)
  eMin: Quantity                 # Minimum dead load
  vMin: Quantity                 # Minimum verification interval
  dr: Quantity                   # Readability (scale interval)
  tMin: Quantity                 # Lower rated temperature
  tMax: Quantity                 # Upper rated temperature
  ratedOutput: Quantity          # Bridge output at E_max (mV/V)
}

type MetrologicalLimits {
  # The Recommendation's governed limits (R 60-1 §5; varies per kind).
  mpe: MpeBands!                 # maximum permissible error per load band
  repeatability: Float           # R 60-1 §5.5.1
  creepAllowance: Float          # R 60-1 §5.5.1 (p_lc × MPE)
  temperatureEffectOnSpan: Float
  temperatureEffectOnZero: Float
}

type MpeBands {
  bands: [MpeBand!]!
}
type MpeBand {
  lowerKg: Float!
  upperKg: Float!
  factor: Float!                 # multiplied by v_min
}

type Provenance {
  certificate: String
  firstIssued: String
}

type ServedRegisterInfo {
  target: String!                # 'indication' | 'state' | 'environmental_context' | …
  via: String!                   # the serving operation id
  freshWithinS: Float            # the freshness promise
  returnType: String!            # 'ServedQuantity' | 'String' | 'Environment'
}

type LegalOperationInfo {
  id: String!                    # 'run_self_test' | 'zero_setting' | …
  kind: String!                  # 'command'
}
```

### 3.4 The generation rules

| Model declaration | Schema shape | Notes |
|---|---|---|
| `serve indication via <op>` | `Query.indication: ServedQuantity!` | target `indication` → `ServedQuantity` |
| `serve state via <op>` | `Query.state: String!` | target `state` → `String` |
| `serve environmental_context via <op>` | `Query.environmentalContext: Environment!` | target `environmental_context` → `Environment`; field name snake→camel |
| `serve <other> via <op>` | `Query.<camelTarget>: ServedQuantity!` | default: `ServedQuantity` |
| `serve <target> via <op>` where `<op>` kind = `watch` | **also** `Subscription.<camelTarget>: <ReturnType>!` | watch-kind = poll **and** subscribe |
| `operation <id> (command)` | `Mutation.<camelId>: OpResult!` | |

**Field naming:** snake_case → camelCase via `snakeToCamel` (`packages/core/src/twin-schema.ts:181`). One special case: `environmental_context` → `environmentalContext` (which snakeToCamel would render the same, but the explicit rule documents it).

**Type selection by target:** see `generateTwinSchema` at `packages/core/src/twin-schema.ts:67`. The mapping is data — adding a new served-target type means adding a case there. (TODO future: drive the target→type map from the model itself, so the schema generator becomes fully data-driven.)

### 3.5 The wire format

**Request:** HTTP POST to `/twin`, JSON body:

```json
{ "query": "{ indication { value unit servedAt } }" }
```

Optional `variables` and `operationName` per the GraphQL spec.

**Response (success):**

```json
{
  "data": {
    "indication": { "value": 40.05, "unit": "kg", "kind": "mass", "servedAt": 1700000000 }
  }
}
```

**Response (error):**

```json
{ "errors": [{ "message": "Cannot query field \"foo\" on type \"Query\"." }] }
```

**Subscriptions:** POST with `accept: text/event-stream`. The response body is an SSE stream. Each `data:` line carries a JSON payload whose shape matches the GraphQL subscription's data field:

```
data: {"data":{"state":"ready"}}

data: {"data":{"state":"fault"}}
```

The server emits the current value immediately on subscribe, then the new value on every clock advance (deduped by JSON identity). See `watchStream` at `packages/core/src/twin-schema.ts:144`.

### 3.6 Freshness enforcement

Each serve carries `freshWithinS`. A client should treat a value as **stale** if `Date.now()/1000 - response.servedAt > freshWithinS`. This is the **stale-twin** defence (TODO 30) — a model that declares `fresh_within 5s` is promising that served values are never more than 5 seconds old; a client that detects a violation is witnessing a stuck instrument.

The typed `TwinDriver<C>` enforces freshness automatically (warn/throw per `DriverOpts.onStale`).

### 3.7 Conformance check (the no-drift guarantee)

At startup, `checkTwinConformance(schema, contract)` walks the generated schema and asserts it equals the contract (and, in development posture, the upstream `.prl` package). Any diff prints the diff and `process.exit(1)`. The served API can never drift from the model — drift is a startup failure, not a runtime behaviour.

### 3.8 Worked example: the LC-500 (R 60 load cell)

A client queries the indication:

```bash
curl -X POST http://localhost:5290/twin \
  -H 'content-type: application/json' \
  -d '{"query":"{ indication { value unit servedAt } }"}'
```

Response (with no load applied, clock at t=0):

```json
{ "data": { "indication": { "value": 0, "unit": "kg", "servedAt": 0 } } }
```

Apply a 40 kg load (via `/world`) and the next indication carries it. Run a self-test:

```bash
curl -X POST http://localhost:5290/twin \
  -H 'content-type: application/json' \
  -d '{"query":"mutation { runSelfTest { state } }"}'
```

Response:

```json
{ "data": { "runSelfTest": { "state": "ready" } } }
```

## 4. The `/world` channel — kind-driven

Unlike `/twin`, `/world` is **kind-driven**: the kind's `world-kind.yaml` declares the kind-specific mutations, layered on top of the runtime's fixed base surface. The model does not participate in `/world` (the epistemic wall keeps the two channels separate).

### 4.1 The base surface (always present)

```graphql
type Query {
  clock: Float!
  groundTruth: GroundTruth!        # kind-specific shape
  scenarios: [ScenarioInfo!]!
  profiles: [ProfileInfo!]!        # the D 11 profile library
}

type Mutation {
  setEnvironment(conditions: EnvironmentInput!): WorldState!
  playProfile(profile: String!): WorldState!
  advanceTime(seconds: Float!): WorldState!
  setClockMode(mode: String!): WorldState!   # 'manual' | 'wall'
  scenario(name: String!): WorldState!
  injectFault: WorldState!
  clearFault: WorldState!
  reset: WorldState!
}

type WorldState { clock: Float!, mode: String!, groundTruth: GroundTruth! }
input EnvironmentInput { temperatureDegC: Float, humidityPercentRh: Float, pressureKPa: Float }
```

`GroundTruth` is kind-specific — R 60 exposes `appliedLoadKg`, `strainMm`, `spanDriftFraction`, etc.; R 144 exposes `appliedGasConcentration`, etc.

### 4.2 Kind-specific mutations

Each kind's `world-kind.yaml` declares its actuation vocabulary. For R 60 (load cell):

```graphql
extend type Mutation {
  placeLoad(massKg: Float!): WorldState!
  removeLoad: WorldState!
  setFidelity(servedOffsetKg: Float, servedLagS: Float): WorldState!
  fidelityReset: WorldState!
  setThermalHysteresis(perDegC: Float!, tauS: Float): WorldState!
}
```

See the per-kind table in `specs/10-twin-driver.md` §"Per-kind driver surfaces".

### 4.3 Auth — `SIM_WORLD_TOKEN`

When the `SIM_WORLD_TOKEN` environment variable is set, **every `/world` mutation** requires `Authorization: Bearer <token>`. A mutation without it is rejected 401 before any resolver runs:

```json
{
  "errors": [{
    "message": "unauthorized: /world mutations require Authorization: Bearer <token> (the sim was started with SIM_WORLD_TOKEN set)",
    "extensions": { "code": "UNAUTHORIZED", "http": { "status": 401 } }
  }]
}
```

`/world` queries and the entire `/twin` channel stay open. Unset token = open `/world` (the localhost dev posture; the server logs this at startup).

## 5. Discovery

A client that doesn't have the baked contract must learn what the API exposes. Three mechanisms:

### 5.1 GraphQL introspection

Standard introspection against `/twin` or `/world`:

```bash
curl -X POST http://localhost:5290/twin \
  -H 'content-type: application/json' \
  -d '{"query":"{ __schema { queryType { fields { name } } mutationType { fields { name } } subscriptionType { fields { name } } } }"}'
```

The response lists every field, derived from the model at startup.

### 5.2 The baked contract artifact

Each instrument package ships a JSON snapshot at `twin/<name>.twin.json`:

```json
{
  "format": "sim/baked-twin-contract",
  "version": 1,
  "bakedAt": "2026-07-29T01:49:33.313Z",
  "source": "/path/to/acme-lc500",
  "contract": {
    "instrumentId": "acme-lc500",
    "serves": [ ... ],
    "operations": [ ... ]
  }
}
```

This is the canonical machine-readable form of the model's served declarations. A client can read it to know exactly what to expect, with no server roundtrip. The CI `bake-freshness` job re-bakes from the private `.prl` and diffs against the committed artifact — drift is a CI failure.

### 5.3 The `primmel-sst` CLI

```bash
npx primmel-sst validate packages/instances/acme-lc500   # parse + verify a package
npx primmel-sst list-kinds                                # list registered kinds
```

### 5.4 Introspection helper (TypeScript)

For TS clients, `introspectTwin(url)` runs the standard introspection query and returns the typed schema summary. See §6.1.

## 6. Client libraries

### 6.1 TypeScript — `TwinDriver<C>` (the typed client)

The typed client's method surface is **derived from the contract type** via TypeScript mapped types. If you typo `driver.indicationn()`, it won't compile. If the contract changes (the model changes), the driver type changes at the next compile — drift is impossible.

```ts
import { LC500_CONTRACT } from '@primmel/sst-runtime/twin-contract'
import { createTwinDriver } from '@primmel/sst-runtime/twin/driver'

const driver = createTwinDriver(LC500_CONTRACT, 'http://localhost:5290')

const ind    = await driver.indication()    // → ServedQuantity
const st     = await driver.state()         // → string
const result = await driver.runSelfTest()   // → OpResult

for await (const s of driver.subscribeState()) { console.log(s) }  // → string stream

await driver.close()
```

The contract → driver mapping rules (mirror §3.3 exactly):

| Contract declaration | Driver surface |
|---|---|
| `serve indication via get_indication (query)` | `indication(): Promise<ServedQuantity>` |
| `serve state via watch_state (watch)` | `state(): Promise<string>` + `subscribeState(): AsyncIterableIterator<string>` |
| `serve environmental_context via watch_op_state (watch)` | `environmentalContext(): Promise<Environment>` + `subscribeEnvironmentalContext(): AsyncIterableIterator<Environment>` |
| `operation run_self_test (command)` | `runSelfTest(): Promise<OpResult>` |

The mapping is total: every serve produces a read method; every watch-kind serve also produces a subscribe method; every command-kind operation produces an invoke method.

### 6.2 Raw GraphQL (any language)

The wire format is standard GraphQL-over-HTTP + SSE. Any GraphQL client works.

### 6.3 Python example

```python
import requests

res = requests.post('http://localhost:5290/twin', json={
    'query': '{ indication { value unit servedAt } }'
})
print(res.json()['data']['indication'])
```

### 6.4 curl examples

```bash
# Read the indication
curl -X POST http://localhost:5290/twin \
  -H 'content-type: application/json' \
  -d '{"query":"{ indication { value unit servedAt } }"}'

# Run a self-test
curl -X POST http://localhost:5290/twin \
  -H 'content-type: application/json' \
  -d '{"query":"mutation { runSelfTest { state } }"}'

# Apply a load (no token = open /world; with SIM_WORLD_TOKEN set, add -H 'authorization: Bearer <token>')
curl -X POST http://localhost:5290/world \
  -H 'content-type: application/json' \
  -d '{"query":"mutation { placeLoad(massKg: 40) { groundTruth { appliedLoadKg } } }"}'

# Advance the clock 60 seconds
curl -X POST http://localhost:5290/world \
  -H 'content-type: application/json' \
  -d '{"query":"mutation { advanceTime(seconds: 60) { clock } }"}'
```

## 7. Versioning & evolution

**The model is the version.** When the `.prl` package changes:
- The `TwinContract` parsed from it changes.
- `generateTwinSchema` produces a different schema at the next startup.
- The conformance check either accepts the change (if the deployed schema is regenerated) or fails the process (if it isn't).
- The baked `twin/<name>.twin.json` artifact changes — committed to the repo.
- The typed `TwinDriver<C>` type changes at the next `tsc` run.

There is **no backwards-compatibility shim** and **no separate API changelog**. The model IS the API. A client that needs to know "what changed in v2 vs v1" diffs the two models (or the two baked artifacts).

Clients that need stability across model changes should pin to a specific baked artifact version (the `bakedAt` timestamp) and re-introspect when they choose to upgrade.

## 8. Error model

- **GraphQL errors:** standard `{ "errors": [{ "message": "..." }] }` shape, no `data` field.
- **Conformance failure:** `process.exit(1)` at startup with the diff printed. No runtime behaviour.
- **401 on guarded `/world` mutations:** the envelop plugin rejects before any resolver runs; see §4.3.
- **Schema placeholder (no twin loaded):** the masked error `"twin schema not generated/baked — pass twinSchema to createSimServer (see docs §6/§9)"`. This appears only in misconfigured deployments.
- **Stale twin (client-side):** the typed driver detects `servedAt > freshWithinS` and either warns or throws per `DriverOpts.onStale`.

## 9. Status

- ✅ Server-side schema generation (`generateTwinSchema`) — production. Mirrors the full `InstrumentModel` when `contract.model` is present.
- ✅ Conformance check (`checkTwinConformance`) — production, deep-checks the nested model types (not just `Query.instrument` exists).
- ✅ Baked contract artifact (`twin/<name>.twin.json`) — production for all four kinds (R 60 / R 91 / R 129 / R 144).
- ✅ Wire format (HTTP POST + SSE) — production.
- ✅ Auth (`SIM_WORLD_TOKEN`) — production.
- ✅ Typed `TwinDriver<C>` — `ReadMethods<C>` + `SubscribeMethods<C>` + `InvokeMethods<C>` + `FreshnessMap<C>` via mapped types; compile-time-checked.
- ✅ Typed `instrument()` method on `TwinDriver<C>` — `InstrumentMethod<C>` adds a typed `instrument(): Promise<TypedInstrumentModelResponse<C['model']>>` when the contract carries a model.
- ✅ Typed `WorldDriver<K>` — `BaseWorldMutations & BaseWorldReads & K`. Each kind ships its `K` via `world-kind.d.ts` (`R60WorldMutations`, `R144WorldMutations`, `R91WorldMutations`, `R129WorldMutations`). Callers get compile-time-checked mutation methods: `world.placeLoad({ massKg: 40 })`.
- ✅ Per-kind boot-strategy registry — `KIND_BOOT_REGISTRY` maps each kindId to a `KindBootStrategy` that owns its instrument construction, world schema, and TwinIo wiring. `session/boot.ts` is fully kind-agnostic; adding a kind's boot path = adding `boot-strategy-<kind>.ts` + one import. All four OIML kinds boot end-to-end via `runSession`.
- ✅ Boot-time model enrichment — `session/boot.ts` loads the kind's `mpe.yaml`, parses it into `MpeBand[]`, and includes it in `InstrumentModel.metrologicalLimits`.
- ✅ Introspection helper (`introspectTwin` / `introspectWorld`) — production.
- ✅ Bench migration — both channels use the typed drivers (`TwinDriver<typeof LC500_CONTRACT>` for /twin, `WorldDriver<R60WorldMutations>` for /world). Bundle size dropped 87 → 24 kB (gzip 32 → 9 kB).
- ✅ LC500 bin serves the full model mirror end-to-end (`withModel(LC500_CONTRACT, LC500_FULL_MODEL)`).
- ⬜ Migration of remaining call sites — the per-family `bin.test.ts` files and the console's `client.ts` still use hand-rolled `gql()` helpers. TODO 08 (namespace rename) folds them into the typed drivers.

## 10. Why this matters

The platform's central promise is **fully model-driven**: the OIML Recommendation → the Primmel model → the digital twin → the API → the typed client. Each transformation is mechanical and total. There is no point in the chain where a human edits the API by hand.

This means:
- **Certification infrastructure can trust the API.** A served field exists because the model declares it; the model declares it because the OIML Recommendation governs it. There is no "extra" field that crept in via a server-side edit.
- **External clients compile against the model.** A TS client using `TwinDriver<typeof LC500_CONTRACT>` will not compile if it calls a method the model doesn't declare. The model is enforced at the client's compile time, not just the server's runtime.
- **Evolution is mechanical.** Adding a served register = adding a `serve` declaration to the model = the schema, the driver, and the typed client all update on the next compile. No hand-written client code to chase.
