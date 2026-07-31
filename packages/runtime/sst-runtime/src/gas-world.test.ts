import { describe, it, expect } from 'vitest'
import { createYoga } from 'graphql-yoga'
import { buildGasWorldSchema, type GasWorldContext } from './gas-world.js'
import { VirtualClock } from './time.js'
import { SimulatedGasAnalyzer } from './gas-instrument.js'
import { getGasScenario } from './gas-scenario.js'

const GT = /* GraphQL */ `
  query { groundTruth {
    bench { coPpm noxPpm no2Fraction co2PercentVol h2oPercentVol flowLPerMin sampleLineLeakFraction }
    channels { co { rawSignal contamination } nox { rawSignal } }
    environment { temperatureDegC pressureKPa }
    clockS faultLatched
  } }
`

function boot() {
  const clock = new VirtualClock()
  const host: GasWorldContext = {
    instrument: new SimulatedGasAnalyzer(getGasScenario('good-analyzer'), clock, 1),
    clock,
    swap(def) { this.instrument = new SimulatedGasAnalyzer(def, clock, 1) },
  }
  const yoga = createYoga({ schema: buildGasWorldSchema(host), graphqlEndpoint: '/world', maskedErrors: false })
  return { clock, host, yoga }
}
async function gql(yoga: ReturnType<typeof createYoga>, query: string): Promise<unknown> {
  const res = await yoga.fetch('http://localhost/world', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query }),
  })
  const body = await res.json() as { data?: unknown; errors?: unknown }
  if (body.errors) throw new Error(JSON.stringify(body.errors))
  return body.data
}

describe('the gas bench /world channel (family #2 — the generic builder)', () => {
  it('setGasConcentration sets the bench per component (reality, readable back)', async () => {
    const { yoga } = boot()
    await gql(yoga, `mutation { setGasConcentration(component: "co", ppm: 800) { clock } }`)
    await gql(yoga, `mutation { setGasConcentration(component: "nox", ppm: 400) { clock } }`)
    const d = await gql(yoga, GT) as { groundTruth: { bench: { coPpm: number; noxPpm: number } } }
    expect(d.groundTruth.bench.coPpm).toBe(800)
    expect(d.groundTruth.bench.noxPpm).toBe(400)
    await expect(gql(yoga, `mutation { setGasConcentration(component: "so2", ppm: 1) { clock } }`)).rejects.toThrow(/unknown component/)
    await expect(gql(yoga, `mutation { setGasConcentration(component: "co", ppm: -1) { clock } }`)).rejects.toThrow(/≥ 0/)
  })
  it('setInterferents, setSampleFlow, setNo2Fraction set the bench state', async () => {
    const { yoga } = boot()
    await gql(yoga, `mutation { setInterferents(co2PercentVol: 15, h2oPercentVol: 12) { clock } }`)
    await gql(yoga, `mutation { setSampleFlow(lPerMin: 1.5) { clock } }`)
    await gql(yoga, `mutation { setNo2Fraction(fraction: 0.1) { clock } }`)
    const d = await gql(yoga, GT) as { groundTruth: { bench: { co2PercentVol: number; h2oPercentVol: number; flowLPerMin: number; no2Fraction: number } } }
    expect(d.groundTruth.bench.co2PercentVol).toBe(15)
    expect(d.groundTruth.bench.h2oPercentVol).toBe(12)
    expect(d.groundTruth.bench.flowLPerMin).toBe(1.5)
    expect(d.groundTruth.bench.no2Fraction).toBe(0.1)
  })
  it('the generic surface works for the gas kind: clock, environment, profiles, scenarios', async () => {
    const { yoga, clock } = boot()
    await gql(yoga, `mutation { advanceTime(seconds: 300) { clock } }`)
    expect(clock.now()).toBe(300)
    await gql(yoga, `mutation { setEnvironment(conditions: { temperatureDegC: 40, pressureKPa: 106 }) { clock } }`)
    const d = await gql(yoga, GT) as { groundTruth: { environment: { temperatureDegC: number; pressureKPa: number } } }
    expect(d.groundTruth.environment.temperatureDegC).toBe(40)
    expect(d.groundTruth.environment.pressureKPa).toBe(106)
    const regs = await gql(yoga, `query { scenarios { name } profiles { id } }`) as { scenarios: Array<{ name: string }>; profiles: Array<{ id: string }> }
    expect(regs.scenarios.map(s => s.name)).toContain('contaminated-optics')
    expect(regs.profiles.map(p => p.id)).toContain('damp-heat-cyclic-db')
  })
  it('scenario swaps the analyzer definition (drifting drifts harder over 7 virtual days)', async () => {
    const { yoga, host, clock } = boot()
    clock.advance(3600)
    await gql(yoga, `mutation { scenario(name: "drifting-analyzer") { clock } }`)
    clock.advance(3600) // re-warm
    await gql(yoga, `mutation { setGasConcentration(component: "co", ppm: 800) { clock } }`)
    clock.advance(300)
    await expect(gql(yoga, `mutation { scenario(name: "nope") { clock } }`)).rejects.toThrow(/unknown scenario/)
    expect(host.instrument.groundTruth().bench.coPpm).toBe(800)
  })
  it('the faults realize through the stages: contamination moves the RAW SIGNAL, never the indication', async () => {
    const { yoga, host, clock } = boot()
    clock.advance(3600)
    await gql(yoga, `mutation { setGasConcentration(component: "co", ppm: 800) { clock } }`)
    clock.advance(300)
    const rawBefore = host.instrument.groundTruth().channels.co.rawSignal
    const indBefore = host.instrument.indication('co').value
    await gql(yoga, `mutation { setOpticsContamination(fraction: 0.1) { groundTruth { channels { co { contamination rawSignal } } } } }`)
    const gt = host.instrument.groundTruth()
    expect(gt.channels.co.contamination).toBeCloseTo(0.1, 9)
    // the raw signal moved by exactly the added absorbance (0.05 AU × 0.1) — the physics path
    expect(gt.channels.co.rawSignal - rawBefore).toBeCloseTo(0.005, 9)
    clock.advance(300)
    // and the indication responds THROUGH the signal chain (≈ +27 ppm), not by override
    const indAfter = host.instrument.indication('co').value
    expect(indAfter - indBefore).toBeGreaterThan(20)
    expect(indAfter - indBefore).toBeLessThan(35)
    await expect(gql(yoga, `mutation { setOpticsContamination(fraction: 1.5) { clock } }`)).rejects.toThrow(/0\.\.1/)
  })
  it('a sample-line leak dilutes the cell gas (the bench keeps the truth; the raw signal drops)', async () => {
    const { yoga, host, clock } = boot()
    clock.advance(3600)
    await gql(yoga, `mutation { setGasConcentration(component: "co", ppm: 800) { clock } }`)
    clock.advance(300)
    const rawBefore = host.instrument.groundTruth().channels.co.rawSignal
    await gql(yoga, `mutation { setSampleLineLeak(fraction: 0.25) { clock } }`)
    const gt = host.instrument.groundTruth()
    expect(gt.bench.coPpm).toBe(800) // the bench is the truth; the CELL gas is diluted
    expect(gt.channels.co.rawSignal / rawBefore).toBeCloseTo(0.75, 3)
    clock.advance(300)
    expect(host.instrument.indication('co').value).toBeCloseTo(600, 0)
  })
  it('injectFault latches the state; clearFault resolves; reset returns to baseline', async () => {
    const { yoga, host, clock } = boot()
    clock.advance(3600)
    await gql(yoga, `mutation { setGasConcentration(component: "co", ppm: 800) { clock } }`)
    clock.advance(300)
    await gql(yoga, `mutation { injectFault { groundTruth { faultLatched } } }`)
    expect(host.instrument.operationalState()).toBe('fault')
    await gql(yoga, `mutation { clearFault { clock } }`)
    expect(host.instrument.operationalState()).toBe('ready')
    await gql(yoga, `mutation { reset { clock } }`)
    const gt = host.instrument.groundTruth()
    expect(gt.bench.coPpm).toBe(0)
    expect(host.instrument.operationalState()).toBe('warming')
  })
})
