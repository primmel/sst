// session/composite.ts — the composite session boot (specs/13 §2–§6).
//
// composeSession(compositePkg, opts) boots a SYSTEM of instruments as
// ONE SST process: components as in-process sessions, ONE /twin endpoint
// (serves decomposed to components), ONE /world channel (component-scoped
// mutations), with per-tick couplings + a computed composite state rule.
//
// The composite IS a package, not runtime code. The runtime interprets
// the package's composition declaration; nothing about the CGM-200 system
// is hardcoded anywhere.
//
// Boot flow:
//   1. Load the composite manifest; verify it has `composition`.
//   2. For each component instance: resolve + loadPackage + boot as a
//      ComponentSession (in-process, no HTTP) via bootComponent.
//   3. Startup conformance: decomposition values resolve to real component
//      serves; state rule names a registered rule + component.
//   4. Build the composite /twin schema from a baked composite contract;
//      each top-level field's resolver delegates via the decomposition map
//      to the component's TwinIo readers.
//   5. Build the composite /world schema with component-scoped mutations
//      (component(id: ID!): ComponentMutations AND bare <component_id>:
//      ComponentMutations) + single-match unscoped delegation.
//   6. Wire per-tick couplings (a clock listener reads source ports and
//      writes target ports each advance).
//   7. Compute composite state per read via the state-rule registry.
//   8. Boot one HTTP server.

import { existsSync } from 'node:fs'
import { join, resolve, isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'
import { GraphQLSchema, GraphQLObjectType, GraphQLInputObjectType, GraphQLInputFieldConfig, GraphQLString, GraphQLFloat, GraphQLBoolean, GraphQLID, GraphQLNonNull, GraphQLList } from 'graphql'
import type { GraphQLInputType } from 'graphql'
import { VirtualClock } from '../time.js'
import { loadPackage, type LoadedPackage, type CompositionDeclaration } from '../package-loader.js'
import { tryBootFromBehavior } from '../kinds/boot-from-behavior.js'
import { buildTwinIo } from '../kinds/twin-io-builder.js'
import { generateTwinSchema, type TwinIo } from '../twin-schema.js'
import { checkTwinConformance } from '../conformance.js'
import { loadBakedContract } from '../twin-bake.js'
import { createSimServer } from '../server.js'
import { lookupKind } from '../kinds/registry.js'
import { loadPhysicsChain, type PhysicsChainDecl, type InstanceClassification } from '../stages/data-driven.js'
import type { TwinContract } from '../twin-contract.js'
import { readFile } from 'node:fs/promises'
import { parse as parseYaml } from 'yaml'
import type { Session, SessionOptions } from '../session.js'

// ── Path resolution ───────────────────────────────────────────────────

const SESSION_DIR = resolve(fileURLToPath(import.meta.url), '..')
const REPO_ROOT = resolve(SESSION_DIR, '..', '..', '..', '..', '..')
const DEFAULT_KINDS_DIR = join(REPO_ROOT, 'packages', 'kinds')

function kindDir(kindId: string, kindsDir: string): string {
  return join(kindsDir, kindId.replace(/^primmel-/, ''))
}

function kindTwinContractPath(kindId: string, kindsDir: string): string {
  const folder = kindId.replace(/^primmel-/, '')
  const file = folder.replace(/^sst-/, '') + '.twin.json'
  return join(kindsDir, folder, 'twin', file)
}

async function readCoefficients(pkg: LoadedPackage): Promise<Record<string, number>> {
  const coeffRel = pkg.manifest.coefficients
  if (!coeffRel) return {}
  const text = await readFile(join(pkg.rootPath, coeffRel), 'utf-8')
  const parsed = parseYaml(text) as Record<string, Record<string, number>>
  const flat: Record<string, number> = {}
  for (const section of Object.values(parsed)) {
    if (!section || typeof section !== 'object') continue
    for (const [k, v] of Object.entries(section)) {
      if (typeof v === 'number') flat[k] = v
    }
  }
  return flat
}

// ── ComponentSession: one in-process instrument + its schemas ────────

interface ComponentSession {
  id: string                                  // 'analyzer' | 'sampling_line' | …
  instance: LoadedPackage
  kindId: string
  instrument: unknown
  worldSchema: GraphQLSchema                  // the component's own /world schema
  twinSchema: GraphQLSchema                   // the component's own /twin schema
  twinIo: TwinIo
  contract: TwinContract
  behavior: { handlers?: Record<string, (ctx: unknown, args: unknown) => void> } | undefined
}

/** Boot one component as an in-process session (no HTTP server). Used by
 *  composeSession for each component. The single-instance runSession
 *  wraps this with createSimServer; the composite wraps multiple. */
async function bootComponent(
  id: string,
  instance: LoadedPackage,
  clock: VirtualClock,
  seed: number,
  kindsDir: string,
): Promise<ComponentSession> {
  const kindId = instance.manifest.kind
  if (!kindId) throw new Error(`composite component '${id}': instance '${instance.manifest.id}' has no 'kind' reference`)
  lookupKind(kindId) // throws if unknown

  const classification = (instance.manifest.classification ?? {}) as InstanceClassification
  const coefficients = await readCoefficients(instance)
  const chainPath = join(kindDir(kindId, kindsDir), 'physics-chain.yaml')
  const physicsChain: PhysicsChainDecl | undefined = existsSync(chainPath) ? loadPhysicsChain(chainPath) : undefined

  const bootResult = await tryBootFromBehavior({
    instance,
    clock,
    seed,
    classification,
    coefficients,
    kindDir: kindDir(kindId, kindsDir),
    ...(physicsChain ? { physicsChain } : {}),
  })
  if (bootResult === null) {
    throw new Error(`composite component '${id}': instance '${instance.manifest.id}' has no behavior.js`)
  }

  const twinContractPath = kindTwinContractPath(kindId, kindsDir)
  if (!existsSync(twinContractPath)) {
    throw new Error(`composite component '${id}': no twin contract for kind '${kindId}' at ${twinContractPath}`)
  }
  const contract = await loadBakedContract(twinContractPath)
  const twinIo = buildTwinIo(bootResult.instrument, clock, contract, bootResult.behavior)
  const twinSchema = generateTwinSchema(contract, twinIo)
  const diffs = checkTwinConformance(twinSchema, contract)
  if (diffs.length > 0) {
    throw new Error(`composite component '${id}': twin conformance FAILED:\n  - ${diffs.join('\n  - ')}`)
  }

  return {
    id,
    instance,
    kindId,
    instrument: bootResult.instrument,
    worldSchema: bootResult.worldSchema,
    twinSchema,
    twinIo,
    contract,
    behavior: bootResult.behavior,
  }
}

// ── The state-rule registry ──────────────────────────────────────────

interface ComponentStateView {
  state: () => string
}

type StateRule = (
  components: Map<string, ComponentStateView>,
  args: Record<string, unknown> | undefined,
) => string

const STATE_RULES = new Map<string, StateRule>([
  ['any_fault_else_analyzer', (comps, _args) => {
    const named = comps.get('analyzer')
    for (const c of comps.values()) {
      if (c.state() === 'fault') return 'fault'
    }
    return named ? named.state() : 'ready'
  }],
  ['any_fault_else_named', (comps, args) => {
    const namedId = typeof args?.named_component === 'string' ? args.named_component : 'analyzer'
    const named = comps.get(namedId)
    for (const c of comps.values()) {
      if (c.state() === 'fault') return 'fault'
    }
    return named ? named.state() : 'ready'
  }],
  ['all_ok_else_fault', (comps, _args) => {
    for (const c of comps.values()) {
      const s = c.state()
      if (s === 'fault' || s === 'off') return 'fault'
    }
    return 'ready'
  }],
  ['named', (comps, args) => {
    const namedId = typeof args?.named_component === 'string' ? args.named_component : 'analyzer'
    return comps.get(namedId)?.state() ?? 'ready'
  }],
])

// ── The composite twin schema (delegation via decomposition) ──────────

/** Build a composite twin schema by delegating each top-level field to
 *  the corresponding component's TwinIo reader (or computing it via the
 *  state-rule registry for <computed>. fields). */
function buildCompositeTwinSchema(
  decomposition: Record<string, string>,
  components: Map<string, ComponentSession>,
  stateRule: { name: string; args?: Record<string, unknown> },
  contract: TwinContract,
): GraphQLSchema {
  const componentStateViews = new Map<string, ComponentStateView>()
  for (const [id, cs] of components) {
    const inst = cs.instrument as { operationalState?: () => string; state?: () => string }
    componentStateViews.set(id, {
      state: () => inst.operationalState?.() ?? inst.state?.() ?? 'ready',
    })
  }

  const queryFields: Record<string, { type: unknown; resolve: (args?: unknown) => unknown }> = {}
  for (const [target, source] of Object.entries(decomposition)) {
    const [componentId, registerName] = source.split('.')
    if (componentId === '<computed>' && registerName === 'state_rule') {
      // The computed composite state — read via the state-rule registry.
      queryFields[target] = {
        type: GraphQLString,
        resolve: () => STATE_RULES.get(stateRule.name)!(componentStateViews, stateRule.args),
      }
      continue
    }
    const cs = components.get(componentId!)
    if (!cs) throw new Error(`composite twin: decomposition '${target}: ${source}' references unknown component '${componentId}'`)
    // Resolve via the component's TwinIo. The contract's serve target is
    // snake_case; the component instrument's reader follows the same
    // convention (auto-discovered in buildTwinIo).
    queryFields[target] = {
      type: GraphQLString, // placeholder; the resolve returns whatever the reader yields
      resolve: () => readComponentRegister(cs, registerName!),
    }
  }

  // The ServedQuantity shape (matches what generateTwinSchema produces
  // for kind contracts). Composite registers that decompose to a kind
  // register inherit the same wire shape.
  const ServedQuantity = new GraphQLObjectType({
    name: 'ServedQuantity',
    fields: {
      value: { type: GraphQLFloat },
      unit: { type: GraphQLString },
      kind: { type: GraphQLString },
      servedAt: { type: GraphQLFloat },
    },
  })
  const EnvironmentalContext = new GraphQLObjectType({
    name: 'EnvironmentalContext',
    fields: {
      temperatureDegC: { type: GraphQLFloat },
      humidityPercentRh: { type: GraphQLFloat },
      pressureKPa: { type: GraphQLFloat },
    },
  })

  // Rebuild each query field with the correct type (registers that come
  // from a kind contract inherit ServedQuantity; state/operationalState
  // are strings; environmental_context is an object).
  for (const [target, source] of Object.entries(decomposition)) {
    const [componentId, registerName] = source.split('.')
    if (componentId === '<computed>') continue
    const cs = components.get(componentId!)
    if (!cs) continue
    const serve = cs.contract.serves.find(s => s.target === registerName)
    if (!serve) continue
    if (serve.target === 'state') {
      queryFields[target]!.type = GraphQLString
    } else if (serve.target === 'environmental_context') {
      queryFields[target]!.type = EnvironmentalContext
    } else {
      queryFields[target]!.type = ServedQuantity
    }
  }

  const queryType = new GraphQLObjectType({
    name: 'Query',
    fields: queryFields,
  })

  // __typename is required by GraphQL; the rest of the introspection
  // surface is filled in by GraphQLSchema's standard introspection.
  void contract
  return new GraphQLSchema({ query: queryType })
}

/** Read one register from a component's TwinIo/instrument, returning the
 *  same wire shape generateTwinSchema's resolvers produce. */
function readComponentRegister(cs: ComponentSession, registerName: string): unknown {
  // The component's TwinIo carries register readers keyed by snake_case
  // serve targets (set up by buildTwinIo's auto-discovery).
  const reader = cs.twinIo.registers?.[registerName]
  if (reader) return reader()
  // Core targets not in registers[] are handled by the kind's resolvers
  // directly — we resolve via the instrument's own method by convention.
  const inst = cs.instrument as Record<string, unknown>
  if (registerName === 'indication' && typeof inst.indication === 'function') return inst.indication()
  if (registerName === 'state' || registerName === 'operational_state') {
    if (typeof inst.operationalState === 'function') return inst.operationalState()
  }
  if (registerName === 'environmental_context' && typeof inst.environment === 'function') {
    return inst.environment()
  }
  // camelCase fallback
  const camel = registerName.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())
  const fn = inst[camel]
  if (typeof fn === 'function') return (fn as () => unknown).call(inst)
  // Try direct property access (e.g., outlet_composition → outletComposition).
  const direct = inst[camel]
  if (direct != null) return direct
  return null
}

// ── The composite world schema (component-scoped mutations) ──────────

/** Build a composite /world schema. The schema is built ENTIRELY with the
 *  runtime's own graphql types — we never reference types from a component's
 *  worldSchema (each component's bundle has its own graphql instance; using
 *  types across realms causes "GraphQLNonNull from another realm" errors).
 *  We learn each mutation's name + arg names from the component's schema
 *  but rebuild everything fresh. */
function buildCompositeWorldSchema(components: Map<string, ComponentSession>, clock: VirtualClock): GraphQLSchema {
  // The composite's single WorldState type — every mutation returns this.
  const worldStateType = new GraphQLObjectType({
    name: 'WorldState',
    fields: {
      clock: { type: GraphQLFloat, resolve: () => clock.now() },
    },
  })

  // Build the per-component handler dispatch. Each component contributes
  // its kind-specific handlers AND the shared surface (advanceTime, etc.).
  const componentHandlerMap = new Map<string, Map<string, (args: unknown) => void>>()
  for (const [id, cs] of components) {
    const handlers = new Map<string, (args: unknown) => void>()
    // Kind-specific handlers from the behavior.
    const mutationType = cs.worldSchema.getMutationType?.()
    if (mutationType) {
      for (const [fieldName, _field] of Object.entries(mutationType.getFields())) {
        const handler = (cs.behavior?.handlers as Record<string, ((ctx: unknown, args: unknown) => void) | undefined> | undefined)?.[fieldName]
        if (handler) {
          const handlerCtx = { instrument: cs.instrument, clock: (cs as unknown as { clock: unknown }).clock }
          handlers.set(fieldName, (args: unknown) => handler(handlerCtx, args))
        }
      }
    }
    // Shared surface — operates on any instrument via well-known methods.
    const inst = cs.instrument as {
      setEnvironment?: (e: Record<string, unknown>) => void
      injectFault?: () => void
      clearFault?: () => void
      reset?: () => void
    }
    handlers.set('advanceTime', (args: unknown) => {
      const a = args as { seconds: number }
      clock.advance(a.seconds)
    })
    if (typeof inst.setEnvironment === 'function') {
      handlers.set('setEnvironment', (args: unknown) => {
        const a = args as { conditions?: Record<string, number>; temperatureDegC?: number; humidityPercentRh?: number; pressureKPa?: number }
        const env = a.conditions ?? a
        inst.setEnvironment!(env as Record<string, unknown>)
      })
    }
    handlers.set('setClockMode', (_args: unknown) => { /* wall-clock mode not yet wired for composites */ })
    handlers.set('scenario', (_args: unknown) => { /* composite scenarios not yet wired */ })
    handlers.set('playProfile', (_args: unknown) => { /* profiles not yet wired for composites */ })
    if (typeof inst.injectFault === 'function') {
      handlers.set('injectFault', () => inst.injectFault!())
    }
    if (typeof inst.clearFault === 'function') {
      handlers.set('clearFault', () => inst.clearFault!())
    }
    if (typeof inst.reset === 'function') {
      handlers.set('reset', () => inst.reset!())
    }
    componentHandlerMap.set(id, handlers)
  }

  // The shared EnvironmentInput type.
  const envInputType = new GraphQLInputObjectType({
    name: 'EnvironmentInput',
    fields: {
      temperatureDegC: { type: GraphQLFloat },
      humidityPercentRh: { type: GraphQLFloat },
      pressureKPa: { type: GraphQLFloat },
    },
  })

  // The shared surface mutation fields + arg shapes (all runtime-graphql).
  const SHARED_MUTATIONS = [
    { name: 'advanceTime', args: { seconds: { type: new GraphQLNonNull(GraphQLFloat) } } },
    { name: 'setEnvironment', args: { conditions: { type: envInputType } } },
    { name: 'setClockMode', args: { mode: { type: new GraphQLNonNull(GraphQLString) } } },
    { name: 'scenario', args: { name: { type: new GraphQLNonNull(GraphQLString) } } },
    { name: 'playProfile', args: { profile: { type: new GraphQLNonNull(GraphQLString) } } },
    { name: 'injectFault', args: {} },
    { name: 'clearFault', args: {} },
    { name: 'reset', args: {} },
  ]

  // Build the union of all mutation fields: shared surface + every
  // component's kind-specific mutations. We learn each kind mutation's
  // arg names + types from the component's schema but rebuild with the
  // runtime's graphql scalars (avoids cross-realm GraphQLNonNull).
  const unionFields: Record<string, { type: unknown; args: Record<string, { type: unknown }>; resolve: (src: { __componentId: string }, args: unknown) => unknown }> = {}
  for (const shared of SHARED_MUTATIONS) {
    unionFields[shared.name] = {
      type: worldStateType,
      args: shared.args,
      resolve: (src, args) => {
        const handlers = componentHandlerMap.get(src.__componentId)
        const handler = handlers?.get(shared.name)
        if (!handler) throw new Error(`component '${src.__componentId}' does not expose mutation '${shared.name}'`)
        handler(args)
        return {}
      },
    }
  }
  for (const [_id, cs] of components) {
    const mutationType = cs.worldSchema.getMutationType?.()
    if (!mutationType) continue
    for (const [fieldName, field] of Object.entries(mutationType.getFields())) {
      if (unionFields[fieldName]) continue
      // Rebuild args with the runtime's graphql scalars (walk the original
      // arg types and map to our scalars; complex input types fall back to
      // GraphQLString — the handler does its own coercion).
      const argConfigs: Record<string, { type: unknown }> = {}
      for (const arg of field.args ?? []) {
        argConfigs[arg.name] = { type: scalarTypeOf(arg.type) }
      }
      unionFields[fieldName] = {
        type: worldStateType,
        args: argConfigs,
        resolve: (src, args) => {
          const handlers = componentHandlerMap.get(src.__componentId)
          const handler = handlers?.get(fieldName)
          if (!handler) throw new Error(`component '${src.__componentId}' does not expose mutation '${fieldName}'`)
          handler(args)
          return {}
        },
      }
    }
  }

  const componentMutationsType = new GraphQLObjectType({
    name: 'ComponentMutations',
    fields: unionFields,
  })

  // Mutation root fields: component(id: ID!) + bare aliases per id.
  const mutationFields: Record<string, unknown> = {}
  mutationFields.component = {
    type: componentMutationsType,
    args: { id: { type: new GraphQLNonNull(GraphQLID) } },
    resolve: (_src: unknown, args: { id: string }) => {
      if (!components.has(args.id)) {
        throw new Error(`unknown component '${args.id}' (known: ${[...components.keys()].join(', ')})`)
      }
      return { __componentId: args.id }
    },
  }
  for (const [id, _cs] of components) {
    mutationFields[id] = {
      type: componentMutationsType,
      resolve: () => ({ __componentId: id }),
    }
  }

  const queryType = new GraphQLObjectType({
    name: 'Query',
    fields: {
      clock: { type: GraphQLFloat, resolve: () => clock.now() },
    },
  })
  const mutationType = new GraphQLObjectType({
    name: 'Mutation',
    fields: mutationFields,
  })
  return new GraphQLSchema({ query: queryType, mutation: mutationType })
}

/** Map a foreign-realm GraphQL type to the runtime's scalar types. The
 *  composite world schema rebuilds every field with these scalars; complex
 *  input types fall back to String (handlers do their own coercion). */
function scalarTypeOf(t: unknown): unknown {
  // GraphQLNonNull wraps via the `ofType` field; the runtime's GraphQLNonNull
  // is a different constructor but the name + shape are stable. We probe by
  // stringifying to detect the underlying type.
  const str = String((t as { toString?: () => string })?.toString?.() ?? '')
  if (str.includes('Float')) return GraphQLFloat
  if (str.includes('Int')) return GraphQLFloat // GraphQLFloat accepts ints too
  if (str.includes('Boolean')) return GraphQLBoolean
  if (str.includes('ID')) return GraphQLID
  return GraphQLString
}

// ── The composite contract (baked from the composite package) ────────

/** Load the composite's twin contract from packages/instances/<id>/twin/.
 *  Falls back to a contract synthesized from the decomposition if no
 *  baked artifact exists (the composite package may not have baked one). */
async function loadCompositeContract(
  composite: LoadedPackage,
  decomposition: Record<string, string>,
): Promise<TwinContract> {
  const contractPath = join(composite.rootPath, 'twin', 'composite.twin.json')
  if (existsSync(contractPath)) return loadBakedContract(contractPath)
  // Synthesize: one serve per decomposition key, all via 'composite_query'
  // operations. Freshness windows default to 5s; state to 1s.
  const serves = Object.keys(decomposition).map(target => ({
    target,
    via: `get_${target}`,
    freshWithinS: target === 'state' || target === 'operationalState' ? 1 : 5,
  }))
  return {
    instrumentId: composite.manifest.id,
    serves,
    operations: [],
  } as TwinContract
}

// ── The per-tick coupler ─────────────────────────────────────────────

interface CouplingPort {
  componentId: string
  port: string
}

function parseCouplingPort(spec: string): CouplingPort {
  const [componentId, port] = spec.split('.')
  if (!componentId || !port) throw new Error(`invalid coupling port '${spec}' — expected component.port`)
  return { componentId, port }
}

/** Wire the declared couplings as a clock listener. On every advance,
 *  read each source port and write it to its target port. */
function wireCouplings(
  couplings: Array<{ from: string; to: string }>,
  components: Map<string, ComponentSession>,
  clock: VirtualClock,
): () => void {
  const off = clock.onAdvance((dt: number) => {
    void dt
    for (const c of couplings) {
      try {
        const from = parseCouplingPort(c.from)
        const to = parseCouplingPort(c.to)
        const fromComp = components.get(from.componentId)
        const toComp = components.get(to.componentId)
        if (!fromComp || !toComp) continue
        const value = readComponentRegister(fromComp, from.port)
        if (value == null) continue
        writeComponentPort(toComp, to.port, value)
      } catch {
        // A coupling that fails (e.g., an unset port) is non-fatal.
      }
    }
  })
  return off
}

function writeComponentPort(cs: ComponentSession, port: string, value: unknown): void {
  const inst = cs.instrument as Record<string, unknown>
  // setInletComposition etc. — conventionally camelCased setters.
  const camel = `set${port.charAt(0).toUpperCase()}${port.slice(1)}`
    .replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())
  const fn = inst[camel]
  if (typeof fn === 'function') {
    ;(fn as (v: unknown) => void).call(inst, value)
    return
  }
  // Direct property assignment fallback.
  inst[port] = value
}

// ── The public entry ────────────────────────────────────────────────

export async function composeSession(
  composite: LoadedPackage,
  opts: SessionOptions = {},
  paths: { kindsDir?: string } = {},
): Promise<Session> {
  const composition = composite.manifest.composition
  if (!composition) {
    throw new Error(`composeSession: package '${composite.manifest.id}' has no 'composition' block — use runSession for single-kind instances`)
  }

  const kindsDir = paths.kindsDir ?? DEFAULT_KINDS_DIR
  // The clock that all components + the coupler share. The COUPLER must
  // run BEFORE the components each tick so the components see the latest
  // inlet values from the previous tick's source read. We achieve this
  // by subscribing the coupler's pre-pass FIRST (before any component
  // boots) via a mutable reference; the post-pass runs AFTER components.
  const clock = new VirtualClock()
  const seed = opts.seed ?? 42
  const components = new Map<string, ComponentSession>()

  // Pre-pass coupler: subscribe NOW (before components) so it runs first.
  // Reads source → SL.inlet each tick. The components map is populated
  // below; the pre-pass is a no-op until then.
  const couplings = composition.couplings ?? []
  let prePassOff: (() => void) | undefined
  let postPassOff: (() => void) | undefined
  if (couplings.length) {
    prePassOff = clock.onAdvance((dt: number) => {
      void dt
      // Pre-pass: propagate ALL couplings BEFORE any component ticks.
      // This ensures the SL sees the analyzer's latest source on this
      // tick (the analyzer set it via /world mutation before advanceTime).
      for (const c of couplings) {
        try {
          const from = parseCouplingPort(c.from)
          const to = parseCouplingPort(c.to)
          const fromComp = components.get(from.componentId)
          const toComp = components.get(to.componentId)
          if (!fromComp || !toComp) continue
          const value = readComponentRegister(fromComp, from.port)
          if (value == null) continue
          writeComponentPort(toComp, to.port, value)
        } catch { /* non-fatal */ }
      }
    })
  }

  // 1. Boot each component as an in-process session.
  for (const [id, comp] of Object.entries(composition.components)) {
    const compPath = isAbsolute(comp.instance) ? comp.instance : resolve(composite.rootPath, comp.instance)
    const compPkg = await loadPackage(compPath)
    const cs = await bootComponent(id, compPkg, clock, seed, kindsDir)
    components.set(id, cs)
  }

  // Post-pass coupler: subscribe NOW (after components) so it runs last.
  // Reads SL.outlet → analyzer.bench (the SL has ticked by this point,
  // so its outlet reflects this tick's inlet — the steady-state target
  // the runtime wants downstream components to see THIS tick).
  if (couplings.length) {
    postPassOff = clock.onAdvance(() => {
      for (const c of couplings) {
        try {
          const from = parseCouplingPort(c.from)
          const to = parseCouplingPort(c.to)
          const fromComp = components.get(from.componentId)
          const toComp = components.get(to.componentId)
          if (!fromComp || !toComp) continue
          const value = readComponentRegister(fromComp, from.port)
          if (value == null) continue
          writeComponentPort(toComp, to.port, value)
        } catch { /* non-fatal */ }
      }
    })
  }

  // 2. Startup conformance: decomposition values resolve to real
  //    component serves; state rule is registered.
  validateDecomposition(composition, components)
  if (!STATE_RULES.has(composition.state_rule)) {
    throw new Error(`composite '${composite.manifest.id}': state rule '${composition.state_rule}' is not registered (known: ${[...STATE_RULES.keys()].join(', ')})`)
  }

  // 3. Load the composite twin contract + build the composite twin schema.
  const contract = await loadCompositeContract(composite, composition.decomposition)
  const twinSchema = buildCompositeTwinSchema(
    composition.decomposition,
    components,
    { name: composition.state_rule, args: composition.state_rule_args },
    contract,
  )

  // 4. Build the composite world schema.
  const worldSchema = buildCompositeWorldSchema(components, clock)

  // 5. Per-tick couplings are wired above (pre-pass before components,
  //    post-pass after) so components see fresh inlets and downstream
  //    components see fresh outlets each tick.

  // 6. Boot the server.
  const port = opts.port ?? 5393
  const server = await createSimServer({
    worldSchema,
    twinSchema,
    port,
    title: `${composite.manifest.title} (composite SST)`,
    worldToken: opts.worldToken,
    twinStream: {
      clock,
      targets: Object.keys(composition.decomposition),
      read: (target: string) => {
        const source = composition.decomposition[target]
        if (!source) return null
        const [compId, regName] = source.split('.')
        if (compId === '<computed>' && regName === 'state_rule') {
          const views = new Map<string, ComponentStateView>()
          for (const [id, cs] of components) {
            const inst = cs.instrument as { operationalState?: () => string; state?: () => string }
            views.set(id, { state: () => inst.operationalState?.() ?? inst.state?.() ?? 'ready' })
          }
          return STATE_RULES.get(composition.state_rule)!(views, composition.state_rule_args)
        }
        const cs = components.get(compId!)
        return cs ? readComponentRegister(cs, regName!) : null
      },
    },
  })

  return {
    port: Number(new URL(server.url).port),
    url: server.url,
    instanceId: composite.manifest.id,
    kindId: '<composite>',
    close: async () => {
      prePassOff?.()
      postPassOff?.()
      await server.close()
    },
  }
}

function validateDecomposition(
  composition: CompositionDeclaration,
  components: Map<string, ComponentSession>,
): void {
  for (const [target, source] of Object.entries(composition.decomposition)) {
    const [compId, regName] = source.split('.')
    if (compId === '<computed>') {
      if (regName !== 'state_rule') {
        throw new Error(`composite decomposition '${target}': <computed>.${regName} — only <computed>.state_rule is supported`)
      }
      continue
    }
    const cs = components.get(compId!)
    if (!cs) {
      throw new Error(`composite decomposition '${target}': references unknown component '${compId}'`)
    }
    // Verify the register is served by the component's contract.
    const isCore = regName === 'state' || regName === 'operational_state' || regName === 'environmental_context' || regName === 'indication'
    const served = cs.contract.serves.some(s => s.target === regName)
    if (!served && !isCore) {
      throw new Error(
        `composite decomposition '${target}: ${source}': component '${compId}' does not serve '${regName}' ` +
        `(serves: ${cs.contract.serves.map(s => s.target).join(', ')})`,
      )
    }
  }
}
