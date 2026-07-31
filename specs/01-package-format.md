# SST package format — the manifest schema

> **Status:** normative. JSON Schema in `schemas/package-manifest.schema.json`.

Every SST package — base, kind, instance — is a directory (or a ZIP that
extracts to one) with a `package.sst.yaml` manifest at its root. The
manifest declares the package's tier, its references to other packages,
and tier-specific metadata.

## Common fields (all tiers)

```yaml
sst_version: "1.0"               # the SST manifest version (semver)
tier: oiml-base | oiml-kind | primmel-instance
id: <kebab-case-id>              # globally unique across all packages
title: <human title>
maps_to: <oiml-d11-e13 | oiml-r60 | acme-lc500 | …>
description: <one-paragraph>
```

## Tier-specific fields

### `tier: oiml-base`

```yaml
base: ~                          # base packages do not reference another base
condition_classes:               # the condition ids this base declares
  climatic:     [<ids>]
  mechanical:   [<ids>]
  electromagnetic: [<ids>]
  vehicle_supply: [<ids>]
```

### `tier: oiml-kind`

```yaml
base: <base-package-id>          # references the D 11 base this kind builds on
active_domain: <mass | speed | dimensions | gas-concentration | …>
oiml_recommendation:
  id: <oiml-r60 | oiml-r91 | …>
  edition: <year>
  parts: [<oiml-r60-1>, <oiml-r60-2>, …]
```

### `tier: primmel-instance`

```yaml
kind: <kind-package-id>          # references the kind this instance is of
version: <instance package version>
manufacturer:
  id: <mfr-id>
  name: <human>
  country: <ISO 3166-1 alpha-2>
  contact: <email>
classification:                  # value assignments for the kind's classification axes
  <axis>: <value>
design_parameters:               # the instance's rated parameters
  <param>: { value: <number>, unit: <unit> }
model: <relative-path>           # the glTF binary (.glb)
coefficients: <relative-path>    # the physics coefficients YAML
behavior: <relative-path>        # the bundled behavior.js
samples:                         # one or more sample manifests
  - <relative-path>
provenance:                      # optional
  certificate: <id>
  first_issued: <ISO date>
```

## Reference resolution

References (`base:`, `kind:`) are by package id, not path. The runtime
resolves them via:

1. A built-in registry of pre-installed packages (those shipped with
   the SST distribution).
2. A user-uploads registry (uploaded via the shell's upload flow).

If a reference cannot be resolved, the runtime reports precisely which
package is missing.

## Validation rules

1. `id` must be globally unique across all loaded packages.
2. `tier` must be one of the three values.
3. `maps_to` must reference a real standard or product (informative;
   not enforced at load time).
4. Base packages: no `base:` reference.
5. Kind packages: `base:` must reference a loaded base package.
6. Instance packages: `kind:` must reference a loaded kind package;
   `model:`, `coefficients:`, `behavior:`, `samples:` paths must exist
   relative to the package root.

## Example: the three-tier ACME LC-500 stack

**Base** (`packages/base/sst-oiml-base/package.sst.yaml`):
```yaml
sst_version: "1.0"
tier: oiml-base
id: primmel-sst-oiml-base
maps_to: oiml-d11-e13
condition_classes: { climatic: [dry-heat, cold, …], … }
```

**Kind** (`packages/kinds/sst-r60/package.sst.yaml`):
```yaml
sst_version: "1.0"
tier: oiml-kind
id: primmel-sst-r60
base: primmel-sst-oiml-base
active_domain: mass
oiml_recommendation: { id: oiml-r60, edition: "2017" }
```

**Instance** (`packages/instances/acme-lc500/package.sst.yaml`):
```yaml
sst_version: "1.0"
tier: primmel-instance
id: acme-lc500
kind: primmel-sst-r60
manufacturer: { id: mfr-acme, name: ACME Instruments, country: US }
classification: { accuracy_class: C, class_number: 6, n_lc: 6000, … }
design_parameters: { e_max: { value: 500, unit: kg }, … }
model: model.glb
coefficients: coefficients.yaml
behavior: behavior.js
samples: [samples/fresh.yaml, samples/creep-fail.yaml, …]
```

## Backwards compatibility

- `sst_version` is semver. Minor bumps add fields; major bumps may
  restructure. The runtime supports `1.x` manifests; future `2.0`
  manifests require an explicit migration.
- New tier values are a major bump.
- New `active_domain` values are a minor bump (the runtime's
  effect-handler registry grows correspondingly).
