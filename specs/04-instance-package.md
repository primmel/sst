# SST instance tier — the instrument-model package

> **Status:** normative. JSON Schemas in `schemas/coefficients.schema.json`, `schemas/sample.schema.json`.

The instance tier encodes **one physical instrument model** (ACME
LC-500, HBK HLCi, Mettler Toledo MTS, …). It declares:

- **Manufacturer + model designation**
- **Classification values** — the value assignments for the kind's axes
  (e.g. accuracy class C, class number 6, n_lc 6000)
- **Design parameters** — the rated values (E_max, E_min, dr, t_min,
  t_max, etc.)
- **Physics coefficients** — sim-owned values the SSOT does not carry
  (creep τ, hysteresis fraction, TC_zero/span, noise σ, etc.)
- **Sample variants** — fresh / aged / dropped / corroded / lying-twin,
  each with parameter overrides on top of the baseline coefficients
- **Bundled behavior.js** — the JS implementation of the kind's
  interface.d.ts
- **glTF 3D model** — the `model.glb` binary

## Package layout

```
<instance-package>/
  package.sst.yaml               the manifest
  coefficients.yaml              the physics coefficients
  samples/
    <sample-name>.yaml           one per sample variant
  src/
    behavior.ts                  the behavior source (compiled → behavior.js)
  behavior.js                    the bundled artifact (committed for distribution)
  model.glb                      the glTF 2.0 binary
  model.glb.placeholder          text stub while the real model is pending
  catalog.json                   (optional) baked from the SSOT, see 06-catalog-bake.md
  README.md
```

## coefficients.yaml — sim-owned physics

These values are NOT in the OIML SSOT. They are calibrated from
datasheets, literature, or experimental fits. Example (LC-500):

```yaml
mechanical:
  compliance_kg_per_mm: 2.0e-6
  hysteresis_class: 0.45
  creep_coefficient: 3.0e-4
  creep_tau_s: 300
  resonant_hz: 250
  off_center_sensitivity: 0.001

transduction:
  sensitivity_mVperV: 2.0
  gauge_factor: 2.0
  excitation_V: 10
  tc_zero_per_degC: 0.0001
  tc_span_per_degC: 0.0002
  barometric_per_kPa: 0.00005
  reference_temp_degC: 20
  reference_pressure_kPa: 101.325

conditioning:
  stack: digital
  scale_interval_kg: 0.05
  capacity_kg: 500
  filter_tau_s: 1.0
  linearization_error_kg: 0.01
  compensation_residual_per_degC: 0.0005
  noise_sigma_kg: 0.005

temporal:
  warm_up_tau_s: 60
  span_drift_per_day: 0.000005

thermal_hysteresis:
  per_degC: 0.00002
  tau_s: 3600

fidelity:                        # default — the honest twin
  served_offset_kg: 0
  served_lag_s: 0
```

## sample.yaml — variants

```yaml
sample_name: <fresh | aged-2024 | dropped-2023 | …>
serial_number: <manufacturer's serial>
kind_scenario: <id from the kind's scenarios.yaml>
description: <one paragraph>
custody:
  - { at: <ISO date>, event: <manufactured | calibrated | installed | dropped | …>, location: <where>, note: <optional> }
overrides:                       # parameter overrides on top of coefficients.yaml
  <coefficient_path>: <value>
fidelity:                        # twin-fidelity overrides (default = honest)
  served_offset_kg: <kg>
  served_lag_s: <s>
```

A sample either references a `kind_scenario` (a named damage pattern
from the kind's `scenarios.yaml`) or specifies inline `overrides` —
or both (the inline overrides win on conflict).

## behavior.js — the bundled artifact

The runtime imports `behavior.js` (NOT `behavior.ts`) at load time.
The bundle is produced by esbuild:

```bash
esbuild src/behavior.ts --bundle --format=esm --platform=node --outfile=behavior.js
```

The default export must satisfy the kind's `interface.d.ts`:

```ts
export default {
  create(def, clock, seed) { return new <Instance>Instrument(def, clock, seed) },
  handlers: {
    <handlerName>: (ctx, args) => { ctx.instrument.<method>(args) },
    // ...one per mutation declared in world-kind.yaml
  }
}
```

The bundled file is committed to the repo so the distributed ZIP
contains the artifact, not the source. The source lives at
`src/behavior.ts` for readability.

## model.glb — the 3D dynamic artifact

glTF 2.0 binary container. The bench's loader (TODO 04) consumes it.
Supported subset:

- meshes with POSITION + NORMAL + indices
- single base-color material
- node transforms (translation / rotation / scale)
- animation channels on TRS

Node names SHOULD match the kind's `bench.yaml:scene_3d.deformations`
rules — e.g. a node whose name contains "cell" gets squashed with
strain; "weight" gets shown when loaded; "base" is static.

## Adding a new instance of an existing kind

1. Copy the directory of an existing instance of that kind.
2. Edit `package.sst.yaml` (id, manufacturer, classification values,
   design parameters).
3. Edit `coefficients.yaml` (the new instrument's physics).
4. Author `samples/*.yaml` (fresh + any damaged variants).
5. Author `src/behavior.ts` (typically a thin adapter to the existing
   core instrument class during the migration window).
6. Bundle: `npm run bundle` (produces behavior.js).
7. Drop a `model.glb` into the package (or keep the placeholder for
   now).

**Zero edits to the kind package, the base, or the runtime required.**
