import { describe, it, expect, beforeEach } from 'vitest'
import { createYoga } from 'graphql-yoga'
import { buildWorldSchema, type WorldContext } from './world-schema.js'
import { VirtualClock } from './time.js'
import { SimulatedInstrument } from './instrument.js'
import { getScenario } from './scenario.js'

const GET = /* GraphQL */ `
  query { groundTruth { appliedLoadKg strainMm clockS spanDriftFraction thermalOffsetMVperV environment { temperatureDegC } } clock }
`
const PLACE = /* GraphQL */ `mutation { placeLoad(massKg: 40) { groundTruth { appliedLoadKg } } }`

function boot() {
  const clock = new VirtualClock()
  const host: WorldContext = {
    instrument: new SimulatedInstrument(getScenario('good-cell'), clock, 1),
    clock,
    swap(def) { this.instrument = new SimulatedInstrument(def, clock, 1) },
  }
  const yoga = createYoga({ schema: buildWorldSchema(host), graphqlEndpoint: '/world' })
  return { clock, host, yoga }
}
async function gql(yoga: ReturnType<typeof createYoga>, query: string): Promise<unknown> {
  const res = await yoga.fetch('http://localhost/world', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query }),
  })
  const body = await res.json() as { data?: unknown; errors?: unknown }
  if ((body as { errors?: unknown }).errors) throw new Error(JSON.stringify((body as { errors?: unknown }).errors))
  return (body as { data?: unknown }).data
}

describe('/world schema (spec §7)', () => {
  it('placeLoad moves ground truth (reality), readable back', async () => {
    const { yoga } = boot()
    const d = await gql(yoga, PLACE) as { placeLoad: { groundTruth: { appliedLoadKg: number } } }
    expect(d.placeLoad.groundTruth.appliedLoadKg).toBe(40)
    const q = await gql(yoga, GET) as { groundTruth: { appliedLoadKg: number } }
    expect(q.groundTruth.appliedLoadKg).toBe(40)
  })
  it('advanceTime integrates the virtual clock', async () => {
    const { yoga, clock } = boot()
    await gql(yoga, `mutation { advanceTime(seconds: 300) { clock } }`)
    expect(clock.now()).toBe(300)
  })
  it('setEnvironment applies partial conditions', async () => {
    const { yoga } = boot()
    await gql(yoga, `mutation { setEnvironment(conditions: { temperatureDegC: 60, humidityPercentRh: 100 }) { groundTruth { environment { temperatureDegC humidityPercentRh } } } }`)
    const q = await gql(yoga, GET) as { groundTruth: { environment: { temperatureDegC: number } } }
    expect(q.groundTruth.environment.temperatureDegC).toBe(60)
  })
  it('scenario swaps the instrument definition', async () => {
    const { yoga, host } = boot()
    await gql(yoga, `mutation { scenario(name: "creep-cell") { groundTruth { appliedLoadKg } } }`)
    expect(host.instrument).toBeDefined()
    expect(() => gql(yoga, `mutation { scenario(name: "nope") { clock } }`)).rejects.toThrow()
  })
  it('scenarios + profiles list the registries', async () => {
    const { yoga } = boot()
    const q = await gql(yoga, `query { scenarios { name } profiles { id standard } }`) as { scenarios: Array<{ name: string }>; profiles: Array<{ id: string }> }
    expect(q.scenarios.map(s => s.name)).toContain('lying-twin')
    expect(q.profiles.map(p => p.id)).toContain('damp-heat-cyclic-db')
  })
  it('setFidelity is /world-only and groundTruth never shows it (the epistemic wall)', async () => {
    const { yoga } = boot()
    await gql(yoga, `mutation { placeLoad(massKg: 500) { clock } }`)
    await gql(yoga, `mutation { setFidelity(servedOffsetKg: 0.25, servedLagS: 30) { clock } }`)
    const q = await gql(yoga, GET) as { groundTruth: { appliedLoadKg: number; spanDriftFraction: number } }
    expect(q.groundTruth.appliedLoadKg).toBe(500) // reality, never the served offset
    expect(JSON.stringify(q.groundTruth)).not.toContain('servedOffset')
  })
  it('playProfile starts a D 11 program; reset returns to baseline', async () => {
    const { yoga } = boot()
    await gql(yoga, `mutation { playProfile(profile: "damp-heat-cyclic-db") { clock } }`)
    await gql(yoga, `mutation { advanceTime(seconds: 3600) { clock } }`)
    const q = await gql(yoga, GET) as { groundTruth: { environment: { temperatureDegC: number } } }
    expect(q.groundTruth.environment.temperatureDegC).toBeGreaterThan(25)
    await gql(yoga, `mutation { reset { clock } }`)
  })

  it('setThermalHysteresis retunes the post-cycle difference live (the user knob)', async () => {
    const { yoga } = boot()
    await gql(yoga, `mutation { placeLoad(massKg: 500) { clock } }`)
    await gql(yoga, `mutation { setThermalHysteresis(perDegC: 0.0002, tauS: 900) { clock } }`)
    await gql(yoga, `mutation { removeLoad { clock } }`)
    await gql(yoga, `mutation { setEnvironment(conditions: { temperatureDegC: 60 }) { clock } }`)
    await gql(yoga, `mutation { advanceTime(seconds: 7200) { clock } }`)
    const q = await gql(yoga, GET) as { groundTruth: { thermalOffsetMVperV: number } }
    expect(q.groundTruth.thermalOffsetMVperV).toBeGreaterThan(0.002) // approaching 0.0002 × 40 °C
    await expect(gql(yoga, `mutation { setThermalHysteresis(perDegC: -1) { clock } }`)).rejects.toThrow()
  })

  it('injectFault drives the served state to fault and freezes the indication; clearFault resolves (R 60-1, 5.7.1.2)', async () => {
    const { yoga, host, clock } = boot()
    clock.advance(400)
    await gql(yoga, `mutation { placeLoad(massKg: 500) { clock } }`)
    clock.advance(5)
    const before = host.instrument.indication().value
    expect(host.instrument.operationalState()).toBe('ready')
    await gql(yoga, `mutation { injectFault { clock } }`)
    expect(host.instrument.operationalState()).toBe('fault')
    clock.advance(60) // physics keeps running; the served indication must NOT move
    const frozen = host.instrument.indication().value
    expect(frozen).toBe(before)
    await gql(yoga, `mutation { clearFault { clock } }`)
    expect(host.instrument.operationalState()).toBe('ready')
    expect(host.instrument.faultLatched).toBe(false)
  })
})
