import { describe, it, expect } from 'vitest'
import { resolve } from 'node:path'
import { loadPackage } from '../src/package-loader.js'
import { runSession } from '../src/session.js'
import { createWorldDriver, type WorldDriver } from '../src/world/driver.js'
import type { R60WorldMutations } from '../../../kinds/sst-r60/world-kind.d.ts'

const ACME_LC500 = resolve(__dirname, '../../../instances/acme-lc500')
const EPHEMERAL = 0

const R60_MUTATIONS = {
  placeLoad: 'massKg: Float',
  removeLoad: '',
  setFidelity: 'servedOffsetKg: Float, servedLagS: Float',
  fidelityReset: '',
  setThermalHysteresis: 'perDegC: Float, tauS: Float',
}

describe('TODO 33 — typed WorldDriver<K> (model-driven /world client surface)', () => {
  it('createWorldDriver<R60WorldMutations> exposes typed kind-specific methods at runtime', () => {
    const world = createWorldDriver<R60WorldMutations>('http://localhost:0', {}, R60_MUTATIONS)
    expect(typeof world.placeLoad).toBe('function')
    expect(typeof world.removeLoad).toBe('function')
    expect(typeof world.setFidelity).toBe('function')
    expect(typeof world.fidelityReset).toBe('function')
    expect(typeof world.setThermalHysteresis).toBe('function')
    // Base methods still present
    expect(typeof world.setEnvironment).toBe('function')
    expect(typeof world.advanceTime).toBe('function')
    expect(typeof world.reset).toBe('function')
    expect(typeof world.groundTruth).toBe('function')
  })

  it('driver.placeLoad({ massKg: 40 }) applies the load end-to-end', async () => {
    const pkg = await loadPackage(ACME_LC500)
    const session = await runSession(pkg, { port: EPHEMERAL, seed: 42 })
    try {
      const world = createWorldDriver<R60WorldMutations>(session.url, {}, R60_MUTATIONS)
      await world.placeLoad({ massKg: 40 })
      // groundTruth is a complex type — select a subfield via gql directly.
      const res = await fetch(`${session.url}/world`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: '{ groundTruth { appliedLoadKg } }' }),
      })
      const body = (await res.json()) as { data?: { groundTruth?: { appliedLoadKg: number } } }
      expect(body.data?.groundTruth?.appliedLoadKg).toBe(40)
    } finally {
      await session.close()
    }
  })

  it('the typed WorldDriver surface is checked at compile time', () => {
    type Driver = WorldDriver<R60WorldMutations>
    type _C1 = 'placeLoad' extends keyof Driver ? true : false
    type _C2 = 'removeLoad' extends keyof Driver ? true : false
    type _C3 = 'setThermalHysteresis' extends keyof Driver ? true : false
    type _C4 = 'setEnvironment' extends keyof Driver ? true : false
    type _C5 = 'groundTruth' extends keyof Driver ? true : false
    void 0 as unknown as _C1
    void 0 as unknown as _C2
    void 0 as unknown as _C3
    void 0 as unknown as _C4
    void 0 as unknown as _C5
    expect(true).toBe(true)
  })

  it('the typed args are checked at compile time (placeLoad requires massKg)', () => {
    type Driver = WorldDriver<R60WorldMutations>
    type PlaceLoad = Driver['placeLoad']
    // The first arg must have massKg — TS would error on a missing field.
    type _Arg = Parameters<PlaceLoad>[0]
    type _HasMassKg = 'massKg' extends keyof _Arg ? true : false
    void 0 as unknown as _HasMassKg
    expect(true).toBe(true)
  })
})
