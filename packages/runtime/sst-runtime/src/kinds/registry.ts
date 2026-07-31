// kinds/registry.ts — the kind-interface registry.
//
// Each kind package ships an interface.d.ts; the runtime compiles it to
// a JSON Schema descriptor (TODO 02 full) at kind-package build time.
// At load time, the runtime validates each instance's behavior.js
// default export against the descriptor.
//
// The registry is the OCP seam for kinds: adding a kind = adding one
// entry here + a kind package on disk.

export interface KindInterface {
  kindId: string
  activeDomain: string
  defaultPort: number
  defaultScenario: string
}

const KIND_REGISTRY = new Map<string, KindInterface>()

/** Register a kind. Throws if a kind with the same id is already registered. */
export function registerKind(kind: KindInterface): void {
  if (KIND_REGISTRY.has(kind.kindId)) {
    throw new Error(`kind '${kind.kindId}' already registered — known: ${[...KIND_REGISTRY.keys()].join(', ')}`)
  }
  KIND_REGISTRY.set(kind.kindId, kind)
}

/** Look up a kind by id. Throws if unknown. */
export function lookupKind(kindId: string): KindInterface {
  const k = KIND_REGISTRY.get(kindId)
  if (!k) {
    throw new Error(`unknown kind '${kindId}' — known: ${[...KIND_REGISTRY.keys()].join(', ')}`)
  }
  return k
}

/** All registered kind ids (for the shell's gallery). */
export function listKinds(): KindInterface[] {
  return [...KIND_REGISTRY.values()]
}

// ── Built-in kind registrations ──────────────────────────────────────
// Pre-registered to mirror the four shipped kind packages. New kinds
// land as a sibling entry here + a kind package on disk.

registerKind({
  kindId: 'primmel-sst-r60',
  activeDomain: 'mass',
  defaultPort: 5290,
  defaultScenario: 'fresh',
})

registerKind({
  kindId: 'primmel-sst-r91',
  activeDomain: 'speed',
  defaultPort: 5291,
  defaultScenario: 'fresh',
})

registerKind({
  kindId: 'primmel-sst-r129',
  activeDomain: 'dimensions',
  defaultPort: 5129,
  defaultScenario: 'fresh',
})

registerKind({
  kindId: 'primmel-sst-r144',
  activeDomain: 'gas-concentration',
  defaultPort: 5144,
  defaultScenario: 'fresh',
})
