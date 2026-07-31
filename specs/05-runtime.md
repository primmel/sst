# SST runtime — the kind-agnostic loader

> **Status:** normative (target). Implementation: TODO 02.

The runtime is the kind-agnostic process that composes a base + kind +
instance package into a running sim. It exposes a single CLI
(`primmel-sst`) and an HTTP server with `/twin`, `/world`, and `/` (the
bench).

## Package layout (target)

```
packages/runtime/sst-runtime/
  src/
    package-loader.ts        ZIP/dir → LoadedPackage
    kinds/
      registry.ts            Map<KindId, KindInterface>
      r60.ts                 the R 60 kind-interface descriptor
      r91.ts                 (Phase 8)
      r129.ts                (Phase 8)
      r144.ts                (Phase 8)
    stages/
      registry.ts            Map<StageKey, StageFactory>
      mechanical.ts          (load-cell)
      transduction.ts        (load-cell)
      conditioning.ts        (load-cell)
      gas-transduction.ts    (gas analyzer)
      emission.ts            (radar)
      scanning.ts            (dimensioner)
      …
    effects/
      mass.ts                load-cell handlers
      speed.ts               radar handlers (Phase 8)
      dimensions.ts          dimensioner handlers (Phase 8)
      gas-concentration.ts   gas analyzer handlers (Phase 8)
    bin.ts                   the primmel-sst CLI
    server.ts                (migrated from @primmel/sst-runtime)
    twin-schema.ts           (migrated)
    world-schema.ts          (extended for kind-driven composition)
    conformance.ts           (migrated)
    time.ts, physics/…       (migrated)
  tests/
    loader.test.ts
    manifest-schema.test.ts
    behavior-shape.test.ts
    boot.test.ts
```

## The package loader

```ts
interface LoadedPackage {
  manifest: PackageManifest
  tier: 'oiml-base' | 'oiml-kind' | 'primmel-instance'
  path: string                          // the on-disk root
  content: LoadedBaseContent | LoadedKindContent | LoadedInstanceContent
}

async function loadPackage(source: string | URL | Uint8Array): Promise<LoadedPackage>
```

The loader:
1. Detects ZIP vs directory (for ZIP: extract to a temp dir via `yauzl`).
2. Reads `package.sst.yaml`.
3. Validates the manifest against `specs/schemas/package-manifest.schema.json`.
4. Validates tier-specific files (condition files against
   `condition.schema.json`, etc.).
5. Returns the `LoadedPackage`.

## The kind-interface registry

```ts
interface KindInterface {
  kindId: string
  interfaceSchema: JSONSchema           // derived from interface.d.ts
  defaultPort: number
  defaultScenario: string
}

const KIND_REGISTRY = new Map<string, KindInterface>()

function registerKind(kind: KindInterface): void {
  if (KIND_REGISTRY.has(kind.kindId))
    throw new Error(`kind '${kind.kindId}' already registered`)
  KIND_REGISTRY.set(kind.kindId, kind)
}

function lookupKind(kindId: string): KindInterface {
  const k = KIND_REGISTRY.get(kindId)
  if (!k) throw new Error(`unknown kind '${kindId}' — known: ${[...KIND_REGISTRY.keys()].join(', ')}`)
  return k
}
```

Each kind descriptor is produced by compiling the kind's `interface.d.ts`
to a JSON Schema at kind-package build time (a `prepublish` script
using `typescript-json-schema`).

## The physics-stage registry

```ts
interface StageFactory<P> {
  stageKey: string
  create(params: P): Stage
}

const STAGE_REGISTRY = new Map<string, StageFactory<unknown>>()

function registerStage(factory: StageFactory<unknown>): void { ... }
function lookupStage(stageKey: string): StageFactory<unknown> { ... }
```

The kind's `physics-chain.yaml` references stages by key; the runtime
instantiates them with parameters from the instance's `coefficients.yaml`
and the chosen sample's overrides.

## The CLI

```
primmel-sst run <instance-package> [--port <n>] [--sample <name>] [--seed <n>]
primmel-sst validate <package>
primmel-sst bundle <instance-package>
primmel-sst list-kinds
primmel-sst list-instances [--kind <id>]
```

`run` boots a session: loads the instance + its referenced kind + base,
validates the behavior.js shape, composes the schemas, starts the
HTTP server.

## HTTP server

Reuses today's `createSimServer` from `@primmel/sst-runtime` (migrated
unchanged). The endpoints:
- `/twin` — the SMART digital twin interface (GraphQL)
- `/world` — the simulated physical world (GraphQL)
- `/` — the bench SPA (served from the bench package's `dist/`)
- `/kinds`, `/instances`, `/sessions`, `/upload` — REST endpoints for
  the shell (TODO 03)

## Backward compatibility

During the migration window (Phases 3-9), the legacy
`packages/{lc500,r91,md,gas-analyzer}/bin.ts` files become 5-line
shims that call `primmel-sst run <id>` with the family default. Phase 9
deletes them.
