# Composite sessions — one system, many components, one twin

> **Status:** normative (target). Joint with `oimlsmart/smart`
> (TODO.integration/15); the Primmel-side contract
> (`primmel-packages/acme-cgm-system/` + the kernel's C100–C102
> `composed_of` rules, primmel-ts 9beec18) is already landed and gated.
> Implementation: the sst-runtime (this repo).

A **composite session** boots a *system* of instruments as one SST
process: several component sessions behind **one** `/twin` endpoint
whose serves decompose to the components, with the `/world` channel
addressable per component. The composite is a **package, not runtime
code** — the runtime interprets the package's composition declaration;
nothing about the CGM-200 system is hardcoded anywhere.

The worked instance throughout: the ACME CGM-200 continuous gas
monitoring **system** — an analyzer component (the existing
`packages/instances/acme-cgm-200` session) plus a sampling-line
component (probe, pump, conditioning line — the physics that delays,
dilutes, or contaminates the sample before the analyzer sees it).

## 1. The composite package

An SST composite package is an instance-tier package whose manifest
carries `composition` instead of a single-kind `kind` reference:

```yaml
# packages/instances/acme-cgm-system/package.yaml
tier: primmel-instance
id: acme-cgm-system
title: ACME CGM-200 gas analytical system (composite)
composition:
  # The authoritative semantics mirror the Primmel package
  # (oimlsmart/smart primmel-packages/acme-cgm-system/payload/
  # composition.yaml) — see §5. This file is the SST projection of
  # that contract; §6's startup conformance proves they agree.
  source_of_truth: primmel:acme-cgm-system@2026
  components:
    analyzer:
      instance: ../acme-cgm-200        # an instance package path
    sampling_line:
      instance: ../acme-cgm-sampling-line
  decomposition:                        # composite register → component
    indicationCo: analyzer.indicationCo
    indicationNox: analyzer.indicationNox
    state: analyzer.state
    environmentalContext: analyzer.environmentalContext
    sampleFlow: sampling_line.sampleFlow
    samplePressure: sampling_line.samplePressure
    sampleTemperature: sampling_line.sampleTemperature
  state_rule: any_fault_else_analyzer   # see §4
```

Component instances are ordinary instance packages — each boots by the
rules this spec already defines (base + kind + instance composition).
The composite adds **no new component semantics**; it adds the wiring.

The sampling-line component (`packages/instances/acme-cgm-sampling-line`)
is a new instance package of a new `sampling-line` kind package: its
stages model transport delay, dilution, and line losses; its world
handlers accept `setFlowRate`, `setLineTemperature`, `introduceLeak`;
its serves are `sampleFlow`, `linePressure`, `gasTemperature`,
`transportDelayS`; its fault rule is the real interlock — flow below
the declared minimum faults the line. (Kind packages are additive by
§08 — no existing file changes.)

## 2. Boot semantics

`primmel-sst run packages/instances/acme-cgm-system [port]`:

1. The package loader reads the manifest, sees `composition`, and boots
   each component as an **in-process session** (no ports, no HTTP —
   the same session objects `runSession` produces, held internally).
2. The composite server listens on the one port. `/twin` is the
   composite's only twin endpoint; `/world` fans out (§3).
3. Boot order is component-then-composite: a component that fails its
   own startup conformance fails the composite boot with the
   component's error wrapped (`composite component analyzer: …`).

## 3. The twin decomposition + the world fan-out

**`/twin` (queries).** The composite's served schema exposes exactly
the `decomposition` keys as top-level registers, plus the computed
`operationalState` (§4). Each query resolves by delegation: reading
`indicationCo` evaluates `analyzer`'s `indicationCo` serve
in-process and returns it with the component's own `servedAt` and
freshness metadata. A component read failure surfaces as that
register's `unavailable` — never as a silent zero and never fatal to
the other registers.

**`/twin` (watch/stream).** The composite stream merges the
components' streams: each frame carries the register id; subscribers
see one ordered stream. Freshness windows ride the composite
declaration.

**`/world` (mutations).** World mutations are component-scoped. Two
equivalent shapes are accepted:

```graphql
mutation { component(id: "sampling_line") { setFlowRate(lPerMin: 2.0) { clock } } }
mutation { sampling_line { setFlowRate(lPerMin: 2.0) { clock } } }
```

Unscoped mutations that exist on exactly one component delegate to it;
ambiguous unscoped mutations are rejected with the ambiguity named.
World state is per component: the analyzer's world and the sampling
line's world evolve independently, coupled only by physics the kind
packages declare (the analyzer's input concentration is the sampling
line's output — the coupling is the sampling-line kind's
`outlet_composition` feeding the analyzer kind's `inlet_composition`,
declared in the kind packages, computed by the runtime each tick).

## 4. The composite state rule

`state_rule: any_fault_else_analyzer` names one of a closed set of
server-side rules (extensible by registry, never by package-authored
code):

- `any_fault_else_analyzer` — `fault` when ANY component's operational
  state is `fault`; otherwise the named component's state (here the
  analyzer's). This is the rule the Primmel package declares; the
  runtime computes it per tick from component states.

The computed state is served as `operationalState` on the composite
/twin and stamped on every composite frame.

## 5. The Primmel bridge (the authority question)

The **authoritative** composition semantics live in the Primmel
package `acme-cgm-system` (`payload/composition.yaml` +
`model/cgm-system.prl`'s `composed_of` facet, kernel rules C100–C102):
the decomposition map, the state rule, the component certificate
references the composition calculus reads (weakest-link: a suspended
component degrades the composite to the DECLARED partial state).

The SST composite package is a **projection** of that contract. Two
conformance legs keep the projection honest:

1. **Shape leg (this repo):** the composite manifest validates against
   `specs/schemas/composite-package.schema.json` — decomposition total
   (every composite register sourced exactly once), component instance
   paths resolvable, state rule in the registry.
2. **Agreement leg (the smart repo's acceptance):** the acceptance
   suite parses the Primmel package with the real kernel and asserts
   the booted session's register set ≡ the Primmel decomposition's
   registers — drift fails there, never silently.

## 6. Startup conformance

Beyond each component's own conformance, the composite boot checks:

- every `decomposition` value resolves to a serve the component's
  schema actually exposes;
- every serve the composite contract (the R 144 twin projection)
  requires is present in the decomposition;
- the state rule names a registered rule and an existing component.

Failure is a boot error with the offending declaration named.

## 7. What the smart repo's acceptance will drive (the contract test)

`browser/src/__tests__/composite-sst-acceptance.test.ts` (skip-guarded
on this package existing): boot the session; read every decomposed
register through `/twin`; drive `/world` on the sampling line (cut the
flow) and watch the analyzer-facing registers degrade through the
declared coupling; fault one component and read `operationalState:
fault`; restore and read the analyzer's state again. The acceptance
runs unchanged against any composite built to this spec — the CGM
system is the first, never the special case.
