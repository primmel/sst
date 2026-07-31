# SST design decisions — the ADR log

> **Status:** informative. Records the "why" behind each architectural choice.

Each ADR (Architecture Decision Record) carries: the context, the
options considered, the decision, and the consequences.

## ADR-001 — One runtime, generic over kinds

**Context.** The legacy `sim-instruments` had one `bin.ts` per family,
each hand-copying an 80-line template with hard-coded port, default
scenario, contract artifact, WorldKind selection.

**Options.**
1. One runtime, generic over kinds (the chosen design).
2. Per-family runtime with a shared core.
3. Monolithic single binary that special-cases each family.

**Decision.** One runtime, generic over kinds. The kind-interface
registry and the physics-stage registry are the OCP seams. Adding a
kind = adding files, not editing existing ones.

**Consequences.**
- The runtime must validate every loaded instance against its kind's
  interface.
- New active domains require runtime-side effect handlers (additive).
- The legacy per-family bin.ts files become shims during the migration
  window, then deleted.

## ADR-002 — glTF 2.0 binary (.glb) for 3D models

**Context.** Each instance carries a 3D dynamic artifact. The bench
uses raw WebGL2 (no Three.js).

**Options.**
1. glTF 2.0 binary (.glb) — the web standard.
2. OBJ — simpler but no animation.
3. Custom binary format — maximum control, minimum interop.
4. Procedural geometry only — what the bench does today.

**Decision.** glTF 2.0 binary. The bench ships a minimal loader
(POSITION + NORMAL + indices + node transforms + animation channels).
Full glTF spec compliance (PBR materials, skins, morph targets) is
deferred.

**Consequences.**
- A minimal loader is ~500 lines; adding features incrementally.
- Authors export from Blender (or any glTF-aware tool).
- The bench stays free of Three.js — keeps the bundle small and the
  raw-WebGL2 aesthetic intact.

## ADR-003 — Bundled behavior.js per instance (not YAML DSL)

**Context.** Each instance needs to define its physics behavior. Two
approaches: declarative YAML interpreted by the runtime, or per-instance
JS code implementing a kind-defined interface.

**Options.**
1. Declarative YAML + a runtime-side effect-handler registry.
2. Per-instance bundled behavior.js implementing a kind interface.
3. Hybrid: YAML for the SDL + JS for the behavior (the chosen design).

**Decision.** Hybrid. The kind's `world-kind.yaml` declares SDL +
handler-method names; the instance's `behavior.js` implements the
handlers. The runtime validates behavior.js against the kind's
interface.d.ts at load time.

**Consequences.**
- Each instance is fully self-describing — its physics lives in its
  own package.
- True plug-and-play: upload a ZIP, the runtime just needs to know the
  interface contract.
- The trade-off: a per-instance JS file is more flexible than YAML but
  less declarative. The hybrid captures both: SDL is declarative;
  behavior is procedural.
- Security consideration: loading arbitrary JS code is risky. Phase 4
  validates server-side (not in the browser). A hardened browser-only
  flow is future work.

## ADR-004 — Base tier bundled with the runtime

**Context.** The OIML D 11 base package could be (a) always bundled
with the runtime, or (b) a separately uploadable ZIP.

**Options.**
1. Bundled (the chosen design).
2. Separately uploadable.
3. Hybrid: bundled by default, overridable.

**Decision.** Bundled. The runtime always loads the same D 11 base;
instance packages reference it implicitly.

**Consequences.**
- Simpler runtime: no need to resolve base references from uploads.
- A future D 11 Edition 14 requires a runtime release.
- If a kind needs a different base (unlikely), it can override the
  reference; the runtime supports this in the manifest schema but
  doesn't encourage it.

## ADR-005 — Damage scenarios at the kind level, not the instance

**Context.** "Fresh", "creep-fail", "lying-twin" are patterns that
recur across instances of a kind.

**Options.**
1. Kind-level damage scenarios (the chosen design).
2. Per-instance damage definitions.
3. Free-form: each sample invents its own.

**Decision.** Kind-level. The kind's `scenarios.yaml` declares named
patterns with parameter overrides. Instances reference them by id;
instances can add per-sample overrides on top.

**Consequences.**
- A new sample variant is data-only — reference a scenario, done.
- The patterns are consistent across instances of a kind.
- A genuinely new damage mode requires editing the kind's scenarios.yaml
  (a kind-level concern, allowed).

## ADR-006 — Influence vs disturbance is the load-bearing classification

**Context.** D 11 §2 distinguishes influence quantities (within rated
range, cause errors) from disturbances (outside rated range, cause
faults).

**Options.**
1. Treat both uniformly as "environmental conditions".
2. Split them at the data layer (the chosen design).
3. Split them at the runtime layer (every condition carries a flag).

**Decision.** Split at the data layer. Each condition file declares
`classification: influence | disturbance`. The runtime applies
influences as continuous coefficients; disturbances as fault-latching
events.

**Consequences.**
- The data is self-describing — the runtime doesn't need to know which
  is which a priori.
- Mislabeling a transient as `influence` produces wrong behavior
  (silent error). The condition schema enforces the enum.
- Test coverage (TODO 10) catches mislabels.

## ADR-007 — The shell is a separate Astro + Vue app, not part of the bench

**Context.** The shell (gallery, upload, sessions) is conceptually
separate from the bench (one running instrument's UI).

**Options.**
1. One Astro app that does both.
2. Separate apps, the shell embeds the bench via iframe (the chosen
   design).
3. The shell is part of the runtime; the runtime serves everything.

**Decision.** Separate apps, iframe embed. The shell owns the URL
space (kinds / instances / sessions); the bench owns the canvas.

**Consequences.**
- The shell can be developed/deployed independently of the bench.
- Multiple sessions in tabs are trivially independent.
- Iframe cross-origin needs CORS configuration (the runtime
  allow-lists the shell's origin).
- Matches the SMART app's existing embed pattern (the bench is also
  iframed by the SMART app at `/app/sim`).

## ADR-008 — No Three.js for the glTF loader

**Context.** glTF is the model format; we need a loader.

**Options.**
1. Use Three.js (full-featured, large bundle).
2. Use a smaller glTF library (e.g. `gltf-viewer`).
3. Hand-write a minimal loader for raw WebGL2 (the chosen design).

**Decision.** Hand-write a minimal loader. The bench's existing
two-light shader is reused; we add ~500 lines of glTF parsing.

**Consequences.**
- Bundle stays small.
- The bench's raw-WebGL2 aesthetic is preserved.
- We implement only the glTF subset we need (static meshes + node
  transforms + animation). PBR/skins/morph targets are deferred.

## ADR-009 — Backward compatibility during migration, then deletion

**Context.** The legacy `@sim/*` packages must keep working while the
SST architecture lands.

**Options.**
1. Big-bang rewrite.
2. Side-by-side with shims, then delete legacy at the end (the chosen
   design).

**Decision.** Side-by-side. The legacy `bin.ts` files become shims
calling `primmel-sst run <id>` under the hood. Phase 9 deletes them
once the SST packages are demonstrably equivalent.

**Consequences.**
- Each phase is independently mergeable.
- The test suite catches behavioral drift early.
- Phase 9 is mechanical but wide (every import changes); one atomic PR.
