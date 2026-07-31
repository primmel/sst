# SST base tier — the OIML D 11 foundation

> **Status:** normative. JSON Schema in `schemas/condition.schema.json` and `schemas/profile.schema.json`.

The base tier owns **passive environmental conditions** — the world
acting on the instrument, never the other way around. Per OIML D 11 §2,
the base distinguishes:

- **Influence quantities** — conditions within rated operating range
  that cause *errors* (shifts in the indication). The sim applies these
  as continuous coefficients.
- **Disturbances** — conditions outside rated range that cause *faults*.
  The sim latches these as operational-state transitions.

## Package layout

```
<base-package>/
  package.sst.yaml              the manifest
  conditions/
    <condition-id>.yaml         one file per D 11 condition class
  profiles/
    <profile-id>.yaml           canonical chamber time-programs
```

## Condition file shape

```yaml
id: <kebab-case-id>             # matches the manifest's condition_classes entry
title: <human title>
kind: steady | cyclic | transient
classification: influence | disturbance
iec_standard: [<refs>]          # IEC / ISO method references
d11_table: <n>                  # the D 11 Ed 13 table number
d11_section: "<x.y>"            # the D 11 Ed 13 section
applicability: [<instrument classes>]
                                # electronic, non-electronic, vehicle-powered
description: >
  <one paragraph: what the condition is, how it acts on the instrument>
severity_levels:
  - { level: <n>, <parameters>, preferred: true | false }
constraints:
  <key>: <value>
```

## The three condition kinds

| `kind` | Description | Sim interpretation |
|---|---|---|
| `steady` | Constant-value hold (temperature, humidity, supply voltage) | A time-program with a single target value; slew-limited ramp. |
| `cyclic` | Repeating time-program (damp heat cyclic Db) | A `profiles/<id>.yaml` reference; the sim loops it. |
| `transient` | Single event (voltage dip, burst, surge, ESD, shock) | An `EnvironmentEvent` with `atS` and `durationS`; the sim schedules it. |

## Severity levels

Each condition declares a closed set of severity levels. The instance
package picks a level by index. Levels are normative — drawn directly
from the D 11 source (`/Users/mulgogi/src/mn/mn-samples-oiml/sources/d011-e13/sections/08-performance-tests.adoc`).

A `preferred: true` marker indicates the OIML-preferred level. Multiple
levels can be preferred (D 11 sometimes prefers two).

## Profile file shape

```yaml
id: <kebab-case-id>
title: <human title>
condition: <condition-id>        # the condition this profile programs
iecs: [<refs>]
total_duration_h: <n>
loop: true | false
keyframes:
  - { at_h: <n>, <parameters> }
constraints:
  <key>: <value>
```

## Coverage

The D 11 Ed 13 canonical set is 35 condition classes across 4 groups
(climatic, mechanical, electromagnetic, vehicle-supply). The current
base package (`packages/base/sst-oiml-base/`) carries all 35; one
extra file (`radiated-rf-fields.yaml`) overlaps conceptually with
`rf-fields-general-origin.yaml` and `rf-fields-digital-radio.yaml`
(D 11 tables 32, 33, 34) and is kept as a synonym.

## Adding a new condition

(Authoring recipe — see `08-additive-extension.md` for the full
cookbook.)

1. Author `conditions/<new-id>.yaml` following the shape above.
2. Add the id to `package.sst.yaml:condition_classes:<group>`.
3. If it's a `cyclic` condition, author a matching `profiles/<id>.yaml`.
4. The runtime picks it up automatically on next boot.

No edits to existing conditions, kinds, or instances required.
