# SST additive extension — the cookbook

> **Status:** normative. These are the step-by-step recipes for adding
> things to the platform without editing existing code.

## Recipe 1 — Add a new D 11 condition class

When OIML D 11 adds a new condition (e.g. a new EMC test), or when you
notice one of the 35 canonical conditions is missing.

### Steps

1. Author `packages/base/sst-oiml-base/conditions/<id>.yaml` following
   the shape in `02-base-package.md`.
2. Add the id to `package.sst.yaml:condition_classes:<group>`.
3. If the condition is `cyclic`, also author
   `packages/base/sst-oiml-base/profiles/<id>.yaml`.
4. Re-boot the runtime.

### What you DON'T edit

- Any kind package. Kinds don't carry conditions; they only consume
  them via the instance's environmental-response metadata.
- The runtime. The loader picks up new conditions automatically.

### Acceptance

- `primmel-sst validate packages/base/sst-oiml-base` succeeds.
- A kind's bench can play the new condition via `play profile <id>`.

---

## Recipe 2 — Add a new instance of an existing kind

The most common recipe. E.g. adding the HBK HLCi as a second load cell.

### Steps

1. `cp -r packages/instances/acme-lc500 packages/instances/<new-id>`
2. Edit `package.sst.yaml`:
   - `id: <new-id>`
   - `title: <manufacturer model>`
   - `manufacturer: { id, name, country }`
   - `classification: { accuracy_class, class_number, n_lc, … }` — the
     new instrument's class values.
   - `design_parameters: { e_max, dr, t_min, t_max, … }` — the new
     ratings.
3. Edit `coefficients.yaml` — replace every value with the new
   instrument's measured physics.
4. Author `samples/*.yaml` — at minimum a `fresh.yaml`; add damaged
   variants as needed.
5. Edit `src/behavior.ts` — adjust the legacy adapter if the new
   instrument needs different stage wiring.
6. `npm run bundle` (produces `behavior.js`).
7. Drop a `model.glb` into the package (or keep the placeholder).
8. `primmel-sst validate packages/instances/<new-id>`.
9. `primmel-sst run <new-id>`.

### What you DON'T edit

- The kind package (sst-r60 for a new load cell).
- The runtime.
- Any other instance package.

### Acceptance

- The shell shows the new card under the kind's instance gallery.
- `primmel-sst run <new-id>` boots; both channels respond.
- The instrument's classification drives the right MPE band in the graph.

---

## Recipe 3 — Add a new instrument kind

E.g. adding R 49 (water meters) as a fifth kind.

### Steps

1. Author the kind package under `packages/kinds/sst-r49/`:
   - `package.sst.yaml` — manifest with `active_domain: flow` (or
     whatever the new domain is).
   - `classification.yaml` — the R 49 closed-enum axes (e.g.
     `nominal_flow_rate`, `temperature_class`, `pressure_class`).
   - `parameters.yaml` — R 49's characteristic parameter formulas.
   - `mpe.yaml` — the per-class MPE envelope per R 49-1.
   - `physics-chain.yaml` — the stages (e.g. `r49/intake → r49/sensor → r49/conditioning`).
   - `world-kind.sdl.graphql` — the kind's Mutation surface (e.g.
     `setFlowRate`, `setTemperature`, `setPressure`).
   - `world-kind.yaml` — mutation → handler binding.
   - `bench.yaml` — HUD cells (flow rate, totalizer, temperature,
     pressure), graph axes, scene_3d (a pipe + turbine).
   - `interface.d.ts` — the TypeScript contract.
   - `scenarios.yaml` — damage patterns (fresh, scaled, leaky, etc.).
2. Register the kind's interface in `packages/runtime/sst-runtime/src/kinds/registry.ts`
   (one new entry — no edits to existing entries).
3. If the kind introduces a new active domain, add the effect handlers:
   - One file per effect in
     `packages/runtime/sst-runtime/src/effects/<domain>.ts`.
4. Author at least one instance package
   (`packages/instances/acme-wm1/` or similar) by analogy with acme-lc500.
5. `primmel-sst validate packages/kinds/sst-r49`.
6. `primmel-sst validate packages/instances/acme-wm1`.
7. `primmel-sst run acme-wm1`.

### What you DON'T edit

- Other kind packages.
- The base package.
- Existing instance packages.
- Existing effect handlers in the runtime (only ADD new ones for the
  new domain).
- Existing entries in the runtime's kind-interface registry (only ADD
  one for the new kind).

### Acceptance

- The shell shows a fifth card on the kinds landing page.
- The new kind's instance(s) appear under `/kind/primmel-sst-r49`.
- A session boots with the new active domain; the new mutations work.

---

## Recipe 4 — Add a new physics stage

E.g. adding a `vibration-coupling` stage to model how mechanical
vibration couples into the load cell's signal.

### Steps

1. Author `packages/runtime/sst-runtime/src/stages/vibration-coupling.ts`
   exporting a `StageFactory`.
2. Register it in `stages/registry.ts` (one new entry).
3. Update the kind's `physics-chain.yaml` to include the new stage key
   (this IS an edit to the kind package — that's allowed; the kind's
   physics-chain is its own concern).

### What you DON'T edit

- Existing stages.
- The runtime's stage registry existing entries.
- Instance packages (their behavior.js automatically picks up the new
  stage via the kind's physics-chain).

### Acceptance

- The new stage runs in the physics pipeline.
- A kind that doesn't include the stage in its physics-chain is
  unaffected.

---

## Recipe 5 — Add a new bench pane

E.g. adding a flow-rate totalizer pane for water meters.

### Steps

1. Author a Vue island component in
   `packages/shell/sst-bench/src/components/FlowTotalizer.vue`.
2. Reference it in the kind's `bench.yaml`:
   ```yaml
   custom_components:
     flow_totalizer:
       component: ./components/FlowTotalizer.vue
       props: { source: groundTruth.totalVolumeL }
   ```
3. The bench's `BenchApp.vue` lazy-loads custom components and mounts
   them in a designated slot.

### What you DON'T edit

- The bench core.
- Other kinds' bench.yaml.

### Acceptance

- The pane appears in sessions of the new kind.
- Other kinds are unaffected.

---

## Anti-recipe — what NOT to do

These actions violate OCP. Each has a documented alternative above.

- **Don't** edit an existing kind package to add a new sample variant.
  Author a new sample file in the instance package instead.
- **Don't** edit the bench to add a kind-specific UI element.
  Put it in `bench.yaml` or as a custom component.
- **Don't** edit the runtime to special-case a kind.
  Add a registry entry or a new effect handler.
- **Don't** edit the base package to add a kind-specific condition.
  Conditions are global; kind-specific behavior lives in the kind.
- **Don't** fork an existing instance to create a variant.
  Use the `samples/` mechanism.

When you find yourself wanting to edit existing code, stop and ask:
"Is there a recipe above that achieves this additively?" If not, the
architecture has a gap — flag it for an ADR (see `09-design-decisions.md`).
