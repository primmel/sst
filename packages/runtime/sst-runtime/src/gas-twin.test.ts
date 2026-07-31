import { describe, it, expect } from 'vitest'
import { existsSync } from 'node:fs'
import { createYoga } from 'graphql-yoga'
import { generateTwinSchema, type TwinIo } from './twin-schema.js'
import { checkTwinConformance } from './conformance.js'
import { GAS_ANALYZER_CONTRACT } from './twin-contract.js'
import { parseTwinContract } from './twin-contract-prl.js'
import { VirtualClock } from './time.js'
import { SimulatedGasAnalyzer } from './gas-instrument.js'
import { getGasScenario } from './gas-scenario.js'

// The R 144 product reference package (the SIM-R144-2 leg in the
// smart repo) has LANDED as primmel-packages/acme-cgm-200 — the
// handshake test below parses it in place and asserts it produces
// exactly GAS_ANALYZER_CONTRACT (the LC500 precedent:
// twin-bake.test.ts). The guard only skips when the (private) smart
// checkout is absent (CI). Override the path with SIM_R144_PRODUCT.
const R144_PKG = process.env.SIM_R144_PRODUCT ?? '/Users/mulgogi/src/oimlsmart/smart/primmel-packages/acme-cgm-200'
const HAS_PKG = existsSync(R144_PKG)

function boot(scenario = 'good-analyzer') {
  const clock = new VirtualClock()
  const instrument = new SimulatedGasAnalyzer(getGasScenario(scenario), clock, 1)
  const io: TwinIo = {
    instrument,
    clock,
    registers: {
      indication_co: () => served(instrument, 'co'),
      indication_nox: () => served(instrument, 'nox'),
    },
    operations: {
      zero_calibration: () => instrument.zeroCalibration(),
      span_calibration: () => instrument.spanCalibration(),
    },
  }
  const schema = generateTwinSchema(GAS_ANALYZER_CONTRACT, io)
  const yoga = createYoga({ schema, graphqlEndpoint: '/twin' })
  return { clock, instrument, yoga, schema }
}
function served(instrument: SimulatedGasAnalyzer, component: 'co' | 'nox') {
  const q = instrument.indication(component)
  return { value: q.value, unit: q.unit, kind: q.kind, servedAt: instrument.servedAt() }
}
async function gql(yoga: ReturnType<typeof createYoga>, query: string): Promise<unknown> {
  const res = await yoga.fetch('http://localhost/twin', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query }),
  })
  return (await res.json() as { data?: unknown; errors?: unknown }).data
}

describe('the R 144 twin (generated from the DECLARED contract — law 2)', () => {
  it('serves one indication register per component, in ppm', async () => {
    const { yoga, instrument, clock } = boot()
    clock.advance(3900) // warm (3600) + settle
    instrument.setGasConcentration('co', 800)
    instrument.setGasConcentration('nox', 400)
    clock.advance(300)
    const d = await gql(yoga, `query { indicationCo { value unit kind servedAt } indicationNox { value unit } }`) as {
      indicationCo: { value: number; unit: string; kind: string; servedAt: number }
      indicationNox: { value: number; unit: string }
    }
    expect(d.indicationCo.value).toBeCloseTo(800, 0)
    expect(d.indicationCo.unit).toBe('ppm')
    expect(d.indicationCo.kind).toBe('concentration')
    expect(d.indicationCo.servedAt).toBe(clock.now())
    expect(d.indicationNox.value).toBeCloseTo(400 * 0.998, 0)
    expect(d.indicationNox.unit).toBe('ppm')
  })
  it('serves state + environmentalContext (watch-kind: Query AND Subscription fields)', async () => {
    const { yoga, schema, clock } = boot()
    clock.advance(3900)
    const d = await gql(yoga, `query { state environmentalContext { temperatureDegC pressureKPa } }`) as {
      state: string; environmentalContext: { temperatureDegC: number; pressureKPa: number }
    }
    expect(d.state).toBe('ready')
    expect(d.environmentalContext.temperatureDegC).toBe(20)
    expect(Object.keys(schema.getSubscriptionType()?.getFields() ?? {})).toEqual(expect.arrayContaining(['state', 'environmentalContext']))
  })
  it('zero/span calibration are instrument-legal mutations acting THROUGH the physics', async () => {
    const { yoga, instrument, clock } = boot()
    clock.advance(3900)
    instrument.setOpticsContamination(0.1) // /world fault — the CO zero climbs ≈ +27 ppm
    clock.advance(300)
    const dirty = await gql(yoga, `query { indicationCo { value } }`) as { indicationCo: { value: number } }
    expect(dirty.indicationCo.value).toBeGreaterThan(20)
    const r = await gql(yoga, `mutation { zeroCalibration { state } }`) as { zeroCalibration: { state: string } }
    expect(r.zeroCalibration.state).toBe('ready')
    clock.advance(300)
    const cured = await gql(yoga, `query { indicationCo { value } }`) as { indicationCo: { value: number } }
    expect(cured.indicationCo.value).toBeCloseTo(0, 0) // within quantization + noise of true zero
    expect(instrument.groundTruth().channels.co.contamination).toBeCloseTo(0.1, 9) // physics untouched
  })
  it('conformance: the generated schema ≡ the declared contract (empty diff)', () => {
    const { schema } = boot()
    expect(checkTwinConformance(schema, GAS_ANALYZER_CONTRACT)).toEqual([])
  })
  it('conformance fails loudly on a tampered contract (a missing serve, an extra serve)', () => {
    const { schema } = boot()
    const missing = { ...GAS_ANALYZER_CONTRACT, serves: GAS_ANALYZER_CONTRACT.serves.filter(s => s.target !== 'indication_nox') }
    expect(checkTwinConformance(schema, missing).join(' ')).toContain('indicationNox')
    const extra = { ...GAS_ANALYZER_CONTRACT, serves: [...GAS_ANALYZER_CONTRACT.serves, { target: 'indication_so2', via: 'get_indication_co' }] }
    expect(checkTwinConformance(schema, extra).join(' ')).toContain('indication_so2')
  })
  it('a declared serve with no register reader fails GENERATION loudly', () => {
    const clock = new VirtualClock()
    const instrument = new SimulatedGasAnalyzer(getGasScenario('good-analyzer'), clock, 1)
    const contract = { ...GAS_ANALYZER_CONTRACT, serves: [...GAS_ANALYZER_CONTRACT.serves, { target: 'indication_so2', via: 'get_indication_co' }] }
    expect(() => generateTwinSchema(contract, { instrument, clock })).toThrow(/no twin register reader for serve target/)
  })
})

describe('the epistemic wall (law 1)', () => {
  it('the twin schema carries no ground truth — no field, no register, no leak', async () => {
    const { yoga, schema } = boot()
    const fields = [
      ...Object.keys(schema.getQueryType()?.getFields() ?? {}),
      ...Object.keys(schema.getMutationType()?.getFields() ?? {}),
      ...Object.keys(schema.getSubscriptionType()?.getFields() ?? {}),
    ]
    for (const f of fields) expect(f).not.toMatch(/groundTruth|bench|rawSignal|contamination|drift|leak|aging/i)
    // a ground-truth-shaped query is simply unanswerable
    const res = await yoga.fetch('http://localhost/twin', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: `{ groundTruth { bench { coPpm } } }` }),
    })
    const body = await res.json() as { data?: unknown; errors?: unknown }
    expect(body.errors).toBeDefined()
    expect(body.data ?? null).toBeNull()
  })
  it('the served answers carry only the legal view (value/unit/kind/servedAt)', async () => {
    const { yoga, clock } = boot()
    clock.advance(3900)
    const res = await yoga.fetch('http://localhost/twin', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: `{ indicationCo { value unit kind servedAt } state }` }),
    })
    const text = await res.text()
    expect(text).not.toMatch(/groundTruth|rawSignal|contamination|zeroRef|spanRef|agingDrift/)
  })
})

describe('the product-package handshake (SIM-R144-2 — the package is the SSOT)', () => {
  it('the real R 144 product package parses to exactly the declared contract', { skip: !HAS_PKG, timeout: 30000 }, async () => {
    const contract = await parseTwinContract(R144_PKG)
    expect(contract).toEqual(GAS_ANALYZER_CONTRACT)
  })
})
