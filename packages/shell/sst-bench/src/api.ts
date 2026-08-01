// api.ts — the bench's channel client: /world for reality (the bench
// scene, the console), /twin for the instrument's legal view (the
// indication display). The two are polled separately ON PURPOSE —
// the epistemic split stays visible in the data flow.
//
// The /twin channel uses the typed TwinDriver — the method surface is
// derived from LC500_CONTRACT at compile time. A typo on `indication`
// or `state` is a compile error, not a runtime GraphQL error. This is
// the model-driven client promise: the .prl model → TwinContract →
// driver surface, end-to-end.
//
// The /world channel still uses the hand-rolled gql() helper because
// the WorldDriver's kind-specific mutations are not yet typed (the kind
// package would need to ship a typed declaration). TODO future.
//
// The world-token knob (TODO.v2/11): when the sim guards /world
// (SIM_WORLD_TOKEN set), the operator supplies the token once — the
// terminal pane prompts on the first rejected mutation. It rides
// sessionStorage (tab-scoped, never persisted) and attaches to
// /world requests only. Unset → no header, the zero-config path.
import { LC500_CONTRACT } from '@primmel/sst-runtime/twin-contract'
import { createTwinDriver, type TwinDriver } from '@primmel/sst-runtime/twin/driver'
import { createWorldDriver, type WorldDriver } from '@primmel/sst-runtime/world/driver'
import type { R60WorldMutations } from '../../../kinds/sst-r60/world-kind.d.ts'

export interface GroundTruth {
  appliedLoadKg: number
  strainMm: number
  clockS: number
  spanDriftFraction: number
  environment: { temperatureDegC: number; humidityPercentRh: number; pressureKPa: number }
}
export interface Indication { value: number; unit: string; kind: string; servedAt: number }

const GT_QUERY = `{ groundTruth { appliedLoadKg strainMm clockS spanDriftFraction environment { temperatureDegC humidityPercentRh pressureKPa } } }`

const WORLD_TOKEN_KEY = 'sim.worldToken'

function store(): Storage | undefined {
  try { return typeof sessionStorage === 'undefined' ? undefined : sessionStorage } catch { return undefined }
}

export function worldToken(): string | undefined {
  return store()?.getItem(WORLD_TOKEN_KEY) ?? undefined
}

export function setWorldToken(token: string): void {
  store()?.setItem(WORLD_TOKEN_KEY, token)
}

export function clearWorldToken(): void {
  store()?.removeItem(WORLD_TOKEN_KEY)
}

/** Did the sim reject this response as unauthorized (the 401 the
 *  /world guard answers with)? gql() unwraps data, so a rejected call
 *  surfaces here as the raw `{ errors }` body. */
export function isUnauthorized(result: unknown): boolean {
  const errors = (result as { errors?: Array<{ extensions?: { code?: string } }> } | null)?.errors
  return errors?.some(e => e.extensions?.code === 'UNAUTHORIZED') ?? false
}

/** The typed /world mutations for R 60 — one entry per R60WorldMutations
 *  method. The values are the SDL arg declarations (parsed by the runtime
 *  to know the field names; the typed surface provides the compile-time
 *  argument shapes). */
const R60_MUTATIONS = {
  placeLoad: 'massKg: Float',
  removeLoad: '',
  setFidelity: 'servedOffsetKg: Float, servedLagS: Float',
  fidelityReset: '',
  setThermalHysteresis: 'perDegC: Float, tauS: Float',
}

/** The /world channel still uses the hand-rolled gql() for groundTruth
 *  (the typed WorldDriver returns `unknown` for groundTruth today since
 *  the GroundTruth shape is kind-specific). The kind-specific MUTATIONS
 *  go through the typed WorldDriver<R60WorldMutations>. */
const worldDrivers = new Map<string, WorldDriver<R60WorldMutations>>()
function worldDriver(baseUrl: string): WorldDriver<R60WorldMutations> {
  let d = worldDrivers.get(baseUrl)
  if (!d) {
    d = createWorldDriver<R60WorldMutations>(`${baseUrl}`, { token: worldToken() }, R60_MUTATIONS)
    worldDrivers.set(baseUrl, d)
  }
  return d
}

export async function placeLoad(baseUrl: string, massKg: number): Promise<void> {
  await worldDriver(baseUrl).placeLoad({ massKg })
}

export async function removeLoad(baseUrl: string): Promise<void> {
  await worldDriver(baseUrl).removeLoad()
}

export async function gql(baseUrl: string, channel: '/world' | '/twin', query: string): Promise<unknown> {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  const token = channel === '/world' ? worldToken() : undefined
  if (token) headers['authorization'] = `Bearer ${token}`
  const res = await fetch(`${baseUrl}${channel}`, {
    method: 'POST', headers, body: JSON.stringify({ query }),
  })
  const body = await res.json() as { data?: unknown; errors?: unknown }
  return body.data ?? body
}

export async function fetchGroundTruth(baseUrl: string): Promise<GroundTruth> {
  const d = await gql(baseUrl, '/world', GT_QUERY) as { groundTruth: GroundTruth }
  return d.groundTruth
}

/** The typed TwinDriver for /twin — methods derived from LC500_CONTRACT.
 *  Cached per baseUrl so we don't reconstruct on every poll. */
const twinDrivers = new Map<string, TwinDriver<typeof LC500_CONTRACT>>()
function twinDriver(baseUrl: string): TwinDriver<typeof LC500_CONTRACT> {
  let d = twinDrivers.get(baseUrl)
  if (!d) {
    d = createTwinDriver(LC500_CONTRACT, `${baseUrl}/twin`)
    twinDrivers.set(baseUrl, d)
  }
  return d
}

export async function fetchIndication(baseUrl: string): Promise<{ indication: Indication; state: string }> {
  // driver.indication() and driver.state() are typed — typos won't compile.
  const d = twinDriver(baseUrl)
  const [indication, state] = await Promise.all([d.indication(), d.state()])
  return { indication: indication as Indication, state }
}

/** Poll both channels at the given cadence; returns the stopper. */
export function startPolling(
  baseUrl: string, intervalMs: number,
  onTruth: (gt: GroundTruth) => void,
  onIndication: (i: { indication: Indication; state: string }) => void,
): () => void {
  let stopped = false
  const tick = async () => {
    if (stopped) return
    try { onTruth(await fetchGroundTruth(baseUrl)) } catch { /* sim down — keep polling */ }
    try { onIndication(await fetchIndication(baseUrl)) } catch { /* placeholder twin pre-C3 */ }
    if (!stopped) setTimeout(() => void tick(), intervalMs)
  }
  void tick()
  return () => { stopped = true }
}
