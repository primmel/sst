# SST OCP patterns — the architecture's discipline

> **Status:** normative. These patterns are the executable form of the
> OCP/MECE/DRY/model-driven/semantically-driven principles the platform
> commits to.

The SST platform is **open for extension, closed for modification** at
every tier. This document catalogs the patterns that make that real and
the anti-patterns that violate it.

## Pattern: additive kind registration

**Goal:** add a new instrument kind (e.g. R 49 water meter) without
editing the runtime or any existing kind.

**Pattern:**
1. Author a kind package under `packages/kinds/sst-<id>/`.
2. Add ONE entry to the runtime's `kinds/registry.ts` (the kind's
   interface descriptor, derived from its `interface.d.ts`).
3. If the kind introduces a new active domain, add ONE file to the
   runtime's `effects/` or `stages/` directory.

**Anti-pattern:** editing an existing kind's files to "make room" for
the new one. If you find yourself doing this, the abstraction is wrong.

## Pattern: additive instance authoring

**Goal:** add a new instance (e.g. HBK HLCi) without editing anything.

**Pattern:**
1. Author an instance package under `packages/instances/<id>/`.
2. Run `primmel-sst validate <id>` to confirm the package is well-formed.
3. The shell picks it up automatically on next boot.

**Anti-pattern:** forking the bench, the runtime, or the kind package
for the new instance.

## Pattern: data-driven UI

**Goal:** the bench's layout, graph, HUD, scene composition are all
read from the kind's `bench.yaml`.

**Pattern:**
- HUD cells: `bench.yaml:hud_cells` declares each cell's label, format,
  channel, and source path.
- Graph: `bench.yaml:graph` declares axes, lines, MPE band source.
- Console grammar: `bench.yaml:console_grammar` declares the kind's
  command set.
- Scene: `bench.yaml:scene_3d` declares which glTF nodes deform and how.

**Anti-pattern:** hard-coding load-cell-specific labels (e.g.
`appliedLoadKg`) in BenchScene.vue or Graph.vue. These belong in
`bench.yaml`.

## Pattern: bundled behavior.js

**Goal:** an instance's behavior is a black box the runtime loads,
validates against the kind's interface, and calls.

**Pattern:**
- The instance ships `behavior.js` (bundled via esbuild from
  `src/behavior.ts`).
- The runtime validates the default export against the kind's
  `interface.d.ts`-derived schema.
- The runtime never reads `src/behavior.ts`.

**Anti-pattern:** the runtime reaching into the instance's source code.
That couples the runtime to a specific build state.

## Pattern: closed-enum axes

**Goal:** classification axes are closed enums; new values are a major
manifest version bump.

**Pattern:**
- The kind's `classification.yaml` declares each axis as a closed list.
- The instance's `package.sst.yaml:classification` assigns a value
  from the closed list.
- The runtime validates that each instance's value is in the kind's
  list.

**Anti-pattern:** free-form classification strings. They drift.

## Pattern: damage scenarios as kind-level data

**Goal:** "fresh", "creep-fail", "lying-twin" are kind-level patterns,
not per-instance inventions.

**Pattern:**
- The kind's `scenarios.yaml` declares each named pattern with
  parameter overrides.
- The instance's `samples/<name>.yaml` references one by id
  (`kind_scenario: <id>`).
- The runtime merges: coefficients.yaml + scenario overrides +
  per-sample overrides.

**Anti-pattern:** each instance redefining "creep-fail" from scratch.

## Pattern: base conditions are globally unique

**Goal:** D 11 condition classes are declared once globally.

**Pattern:**
- `packages/base/sst-oiml-base/conditions/<id>.yaml` declares each
  condition class exactly once.
- Kind packages do NOT redeclare condition classes; they only
  reference them (via the manifest's `condition_classes` list and via
  the bench's environmental-response metadata).

**Anti-pattern:** kind-specific condition definitions. That defeats the
base tier's purpose.

## Pattern: physics stages are reusable across kinds

**Goal:** the runtime's stage registry grows additively; kinds share
stages where physics overlaps.

**Pattern:**
- Stages are keyed by domain-and-mechanism (e.g.
  `r60/mechanical-compression`, `r60/transduction-strain-gauge`).
- The kind's `physics-chain.yaml` names the stages to compose.
- A future kind (e.g. R 49 water meter) might reuse `r60/conditioning-digital`
  if its conditioning is analogous.

**Anti-pattern:** duplicating a stage's logic per kind. If the physics
is the same, share the stage.

## Anti-pattern: configuration in code

**Symptom:** a parameter that should be data is hardcoded in TypeScript.

**Examples:**
- A port number in a family's `bin.ts` (should be the kind's
  `defaults.port`).
- A scenario name as a string literal (should be in `scenarios.yaml`).
- A console command's grammar in `grammar.ts` (should be derivable from
  `world-kind.yaml`).

**Fix:** move it to data; let the code read the data.

## Anti-pattern: doubles in tests

**Symptom:** tests use `double()` or hand-built mock objects instead of
real model instances.

**Fix:** use real model instances. If a model is hard to set up, build
a test factory — don't reach for `double()`. See the global rule.

## Anti-pattern: hand-rolled serialization

**Symptom:** a `to_h()` / `from_h()` / `to_json` method on a model
class that swaps keys or reshapes data.

**Fix:** use the framework's typed shape system. For SST packages, the
YAML IS the wire form; no serialization layer is needed.
