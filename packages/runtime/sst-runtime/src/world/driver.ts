// world/driver.ts — the typed client API for a running instrument's
// /world endpoint. Generated from the kind's world-kind.yaml — the
// mutator counterpart to the TwinDriver.
//
// The kind → driver mapping:
//   - each mutation declared in world-kind.yaml → a typed method
//   - the base /world mutations (setEnvironment, playProfile, advanceTime,
//     setClockMode, scenario, injectFault, clearFault, reset) → shared
//     across kinds (declared in this module)
//   - read methods for groundTruth, clock, scenarios, profiles
//
// Unlike TwinDriver (which is contract-driven and fully generated),
// WorldDriver is kind-driven. The runtime composes the kind's mutations
// with the base's, so the driver surface mirrors what the server actually
// serves.
//
// Typed usage: callers pass the kind's WorldMutations type as a type
// parameter to get compile-time-checked method calls:
//
//   const world = createWorldDriver<R60WorldMutations>(url, {}, { ... })
//   world.placeLoad({ massKg: 40 })   // typed
//
// See packages/kinds/<id>/world-kind.d.ts for each kind's mutation type.

import { gql } from '../twin/transport.js'
import type { WorldState, ScenarioInfo, ProfileInfo } from './types.js'

/** The base /world mutations — shared by every kind. */
export interface BaseWorldMutations {
  setEnvironment(conditions: { temperatureDegC?: number; humidityPercentRh?: number; pressureKPa?: number }): Promise<WorldState>
  playProfile(profile: string): Promise<WorldState>
  advanceTime(seconds: number): Promise<WorldState>
  setClockMode(mode: 'manual' | 'wall'): Promise<WorldState>
  scenario(name: string): Promise<WorldState>
  injectFault(): Promise<WorldState>
  clearFault(): Promise<WorldState>
  reset(): Promise<WorldState>
}

/** The base /world reads — shared by every kind. */
export interface BaseWorldReads {
  groundTruth(): Promise<unknown>
  clock(): Promise<number>
  scenarios(): Promise<ScenarioInfo[]>
  profiles(): Promise<ProfileInfo[]>
}

/** Constraint on the kind-specific mutations surface. Each method
 *  returns a Promise<WorldState>. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type KindWorldMutations = Record<string, (...args: any[]) => Promise<WorldState>>

/** The WorldDriver is base mutations + base reads + the kind's specific
 *  mutations. K is the kind's mutation surface (e.g. R60WorldMutations);
 *  the default is the dynamic index-signature surface for callers that
 *  don't opt into per-kind typing. */
export type WorldDriver<K = KindWorldMutations> = BaseWorldMutations & BaseWorldReads & K

export interface WorldDriverOpts {
  fetch?: typeof fetch
  token?: string | undefined
}

/** Construct a WorldDriver for a /world endpoint. The kind's specific
 *  mutations are added as dynamic methods per the worldKindMutations arg.
 *  Pass a type parameter for compile-time method checking:
 *
 *    createWorldDriver<R60WorldMutations>(url, {}, { ... }) */
export function createWorldDriver<K = KindWorldMutations>(
  url: string,
  opts: WorldDriverOpts = {},
  kindMutations: Record<string, string> = {},
): WorldDriver<K> {
  const driver: Record<string, unknown> = {
    // Base reads
    groundTruth: async () => (await gql(`${url}/world`, '{ groundTruth }', opts)).groundTruth,
    clock:       async () => (await gql(`${url}/world`, '{ clock }', opts)).clock as number,
    scenarios:   async () => (await gql(`${url}/world`, '{ scenarios { name description } }', opts)).scenarios as ScenarioInfo[],
    profiles:    async () => (await gql(`${url}/world`, '{ profiles { id standard } }', opts)).profiles as ProfileInfo[],

    // Base mutations
    setEnvironment: async (c: { temperatureDegC?: number; humidityPercentRh?: number; pressureKPa?: number }) =>
      (await gql(`${url}/world`, `mutation { setEnvironment(conditions: { temperatureDegC: ${c.temperatureDegC ?? 'null'}, humidityPercentRh: ${c.humidityPercentRh ?? 'null'}, pressureKPa: ${c.pressureKPa ?? 'null'} }) { clock mode groundTruth { } } }`, opts)).setEnvironment as WorldState,
    playProfile: async (profile: string) =>
      (await gql(`${url}/world`, `mutation { playProfile(profile: ${JSON.stringify(profile)}) { clock mode } }`, opts)).playProfile as WorldState,
    advanceTime: async (seconds: number) =>
      (await gql(`${url}/world`, `mutation { advanceTime(seconds: ${seconds}) { clock mode } }`, opts)).advanceTime as WorldState,
    setClockMode: async (mode: 'manual' | 'wall') =>
      (await gql(`${url}/world`, `mutation { setClockMode(mode: ${JSON.stringify(mode)}) { clock mode } }`, opts)).setClockMode as WorldState,
    scenario: async (name: string) =>
      (await gql(`${url}/world`, `mutation { scenario(name: ${JSON.stringify(name)}) { clock mode } }`, opts)).scenario as WorldState,
    injectFault: async () =>
      (await gql(`${url}/world`, `mutation { injectFault { clock mode } }`, opts)).injectFault as WorldState,
    clearFault: async () =>
      (await gql(`${url}/world`, `mutation { clearFault { clock mode } }`, opts)).clearFault as WorldState,
    reset: async () =>
      (await gql(`${url}/world`, `mutation { reset { clock mode } }`, opts)).reset as WorldState,
  }

  // Attach kind-specific mutations. The typed WorldMutations surface
  // passes a single args object per call (e.g. placeLoad({ massKg: 40 }));
  // the runtime translates the object's entries into GraphQL args.
  for (const method of Object.keys(kindMutations)) {
    driver[method] = async (argObj?: Record<string, unknown>): Promise<WorldState> => {
      const sdlArgs = argObj
        ? Object.entries(argObj)
            .filter(([, v]) => v !== undefined)
            .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
            .join(', ')
        : ''
      const data = await gql(`${url}/world`, `mutation { ${method}(${sdlArgs}) { clock mode } }`, opts)
      return (data as Record<string, WorldState>)[method] ?? { clock: 0, mode: 'manual', groundTruth: null }
    }
  }

  return driver as WorldDriver<K>
}
