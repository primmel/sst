# SST architecture — the five-layer composition

> **Status:** normative. Code implements this; this is the contract.

The **Primmel SST** (Simulated SMART Twin) platform composes five layers
to produce a running instrument simulation from declarative packages.

```
┌──────────────────────────────────────────────────────────────────────┐
│  @primmel/sst-shell         the UI host (Astro + Vue)                 │
│  routes: / (kinds) → /kind/<id> (instances) → /session/<id> (bench)   │
│  owns: package gallery, upload-a-ZIP, session tabs                    │
└──────────────────────────────────────────────────────────────────────┘
                                  │ HTTP (boot /session → port)
                                  ▼
┌──────────────────────────────────────────────────────────────────────┐
│  @primmel/sst-runtime       the kind-agnostic runtime                 │
│  owns: package loader, kind-interface registry, physics-stage         │
│        registry, /twin + /world schema composition, HTTP server       │
│  bin: primmel-sst                                                     │
└──────────────────────────────────────────────────────────────────────┘
                                  │ composes three package tiers
                                  ▼
┌─────────────────────┬─────────────────────────┬───────────────────────┐
│  base tier          │  kind tier              │  instance tier         │
│  (D 11 conditions)  │  (R 60 / R 91 / ...)    │  (ACME LC-500 / ...)   │
│                     │                         │                        │
│  passive conditions │  classification + MPE  │  manufacturer + model  │
│  influence/disturb. │  active-domain SDL      │  physics coefficients  │
│  severity tables    │  interface.d.ts         │  samples (fresh/dmgd)  │
│  chamber profiles   │  physics-chain template │  bundled behavior.js   │
│                     │  bench metadata         │  glTF 3D model (.glb)  │
└─────────────────────┴─────────────────────────┴───────────────────────┘
```

## The composition rule

A running SST session loads **exactly one instance package**, which
references **exactly one kind package**, which references **exactly one
base package**. The runtime:

1. Loads the instance (`package.sst.yaml`).
2. Resolves its `kind:` reference → loads the kind package.
3. The kind's `base:` reference → loads the base package.
4. Validates the instance's `behavior.js` against the kind's `interface.d.ts`.
5. Composes physics from the kind's `physics-chain.yaml` + the instance's coefficients.
6. Composes `/world` from base (environment mutations) + kind (active-domain mutations).
7. Composes `/twin` from the instance's served contract (already model-driven today).
8. Serves everything on a port; the shell embeds the bench via iframe.

## The OCP seams (where additive extension happens)

| Extension type | What you add | What you DON'T edit |
|---|---|---|
| New D 11 condition | `packages/base/sst-oiml-base/conditions/<name>.yaml` | Anything else |
| New kind | `packages/kinds/<kind-id>/` (full kind package) + one entry in runtime's kind-interface registry | Other kinds, base, existing instances |
| New instance of existing kind | `packages/instances/<id>/` (full instance package) | Anything else |
| New active domain (e.g. flow rate) | One handler file in runtime's effects/stages | Existing handlers |
| New physics stage | One entry in runtime's stage registry | Existing stages |
| New bench pane | One Vue island + an entry in the kind's `bench.yaml:custom_components` | The bench core |

**The principle: adding things is fine; editing existing things is a code smell that needs justification.**

## The MECE rule (no overlap, no gaps)

Each concern lives in exactly one tier:

| Concern | Owner tier |
|---|---|
| What is "temperature"? (a D 11 condition class) | base |
| What is "load cell accuracy class C"? (a closed enum value) | kind (R 60) |
| What is "ACME LC-500" class? (the value C6 for this instrument) | instance |
| What is "placeLoad"? (an active-domain mutation) | kind (R 60) |
| What is "ACME LC-500's creep coefficient"? (a numeric value) | instance |
| How is "placeLoad" executed? (a JS handler) | instance (`behavior.js`) |
| How is "indication" served? (a twin contract declaration) | instance (via upstream Primmel package) |
| How is the /world schema composed? (a registry call) | runtime |
| How is the bench laid out? (HUD cells, graph axes) | kind (`bench.yaml`) |
| How is the bench styled? (colors, fonts) | bench (design tokens — same for all kinds) |

If you find a value defined in two places, one of them is wrong. If you find a concern not owned by any tier, a tier is missing.

## The DRY rule

- **Classification axes** are declared once per kind.
- **MPE formulas** are declared once per kind.
- **Damage patterns** are declared once per kind (in `scenarios.yaml`); instances reference them by name.
- **Condition classes** are declared once globally (in the base package).
- **Physics stages** are registered once each in the runtime.

## Cross-references

- `01-package-format.md` — the manifest schema (all tiers).
- `02-base-package.md` — D 11 base tier.
- `03-kind-package.md` — kind tier (R 60 et al.).
- `04-instance-package.md` — instance tier (ACME LC-500 et al.).
- `05-runtime.md` — runtime internals.
- `06-shell.md` — shell internals.
- `07-ocp-patterns.md` — pattern library.
- `08-additive-extension.md` — the cookbook (step-by-step).
- `09-design-decisions.md` — the ADR log.
