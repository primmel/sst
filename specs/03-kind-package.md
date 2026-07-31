# SST kind tier — the instrument-kind package

> **Status:** normative. JSON Schemas in `schemas/classification.schema.json`, `schemas/mpe.schema.json`, `schemas/world-kind.schema.json`, `schemas/bench.schema.json`.

The kind tier encodes **one OIML Recommendation** (R 60, R 91, R 129,
R 144, …). It declares:

- **Classification axes** — the closed enums that classify instruments
  of this kind (e.g. accuracy class A/B/C/D for load cells).
- **Characteristic parameters** — the formulas that derive one
  parameter from another (e.g. `v_min = (e_max - e_min) / y`).
- **MPE envelope** — the per-class maximum permissible error step
  function.
- **Physics-chain template** — the named stages an instance composes
  to build its physics.
- **Active-domain SDL** — the kind's `/world` Mutation surface (e.g.
  `placeLoad` for load cells, `setTarget` for radar).
- **Interface** — the TypeScript contract (`interface.d.ts`) every
  instance's behavior.js must satisfy.
- **Bench metadata** — how the bench lays out HUD cells, graph axes,
  MPE band source, scene_3d deformations.
- **Damage scenarios** — abstract patterns instances can apply.

## Package layout

```
<kind-package>/
  package.sst.yaml               the manifest
  classification.yaml            the closed-enum axes
  parameters.yaml                characteristic parameter formulas
  mpe.yaml                       the per-class MPE envelope
  physics-chain.yaml             the named physics stages
  world-kind.sdl.graphql         the kind's /world Mutation SDL fragments
  world-kind.yaml                mutation → handler-method binding
  bench.yaml                     the bench UI metadata
  interface.d.ts                 the TypeScript contract for instance behavior.js
  scenarios.yaml                 kind-level damage patterns
```

## world-kind.yaml — the linchpin of plug-and-play

This file binds declared SDL mutations to handler methods on the
instance's behavior.js exports:

```yaml
mutations:
  <MutationName>:
    handler: <handler-method-name>
```

At load time, the runtime:
1. Parses this file.
2. Imports the instance's behavior.js.
3. Verifies every mutation has a matching handler method.
4. Wires them into the composed /world schema.

A mutation without a handler fails loudly. A handler without a
mutation is silently ignored (allows the kind to extend the SDL
incrementally).

## interface.d.ts — the contract

The TypeScript interface declares:

```ts
export interface <Kind>Behavior {
  create(def: <Kind>Definition, clock: VirtualClock, seed: number): <Kind>Instrument
  handlers: {
    <handlerName>: (ctx: WorldContext, args: { ... }) => void
    // ...one per declared mutation
  }
}
```

The instance's behavior.js default export must satisfy this shape.
At package build time, the interface.d.ts is compiled to a runtime
JSON Schema (via `typescript-json-schema` or equivalent); the runtime
uses that schema to validate behavior.js default exports at load time.

## bench.yaml — data-driven UI

The bench (the running-instrument view) reads the kind's `bench.yaml`
to lay out:

- HUD cells (top-left overlays on the 3D scene)
- The indication card (bottom overlay)
- The graph axes, lines, MPE band source
- The console grammar extension
- The paired dial (present/absent + spec)
- The scene_3d deformations (which glTF nodes deform and how)

The bench is kind-agnostic; the YAML is the data. See `05-bench-kind-driven.md`
(the TODO.complete doc) for the migration recipe.

## Adding a new kind

(Authoring recipe — see `08-additive-extension.md` for the full
cookbook.)

1. Author the 10 files above by direct analogy with an existing kind
   package (sst-r60 is the canonical reference).
2. Register the kind's interface.d.ts in the runtime's kind-interface
   registry (one new entry, no edits to existing entries).
3. If the kind introduces a new active domain (e.g. R 49 water meter's
   `flow`), add effect handlers to the runtime's effects registry
   (one new file, no edits to existing handlers).

No edits to other kinds, instances, or the base required.
