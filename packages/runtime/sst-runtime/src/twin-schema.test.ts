import { describe, it, expect } from 'vitest'
import { createYoga } from 'graphql-yoga'
import { generateTwinSchema, type TwinIo } from './twin-schema.js'
import { checkTwinConformance } from './conformance.js'
import { LC500_CONTRACT } from './twin-contract.js'
import { VirtualClock } from './time.js'
import { SimulatedInstrument } from './instrument.js'
import { getScenario } from './scenario.js'

function boot(scenario = 'good-cell') {
  const clock = new VirtualClock()
  const instrument = new SimulatedInstrument(getScenario(scenario), clock, 1)
  const io: TwinIo = { instrument, clock }
  const schema = generateTwinSchema(LC500_CONTRACT, io)
  const yoga = createYoga({ schema, graphqlEndpoint: '/twin' })
  return { clock, instrument, yoga, schema }
}
async function gql(yoga: ReturnType<typeof createYoga>, query: string): Promise<unknown> {
  const res = await yoga.fetch('http://localhost/twin', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query }),
  })
  return (await res.json() as { data?: unknown; errors?: unknown }).data
}

describe('/twin schema generation (spec §6)', () => {
  it('indication serves value+unit+kind+servedAt (the served register)', async () => {
    const { yoga, instrument, clock } = boot()
    clock.advance(400) // past warm-up (5× tau + margin)
    instrument.setLoad(500)
    clock.advance(5)
    const d = await gql(yoga, `query { indication { value unit kind servedAt } }`) as { indication: { value: number; unit: string; kind: string; servedAt: number } }
    expect(d.indication.value).toBeCloseTo(500, 1)
    expect(d.indication.unit).toBe('kg')
    expect(d.indication.kind).toBe('mass')
    expect(d.indication.servedAt).toBe(clock.now())
  })
  it('state serves from the instrument (the LC-500’s governed projection, TODO.v2/16)', async () => {
    const { yoga, clock, schema } = boot()
    clock.advance(400) // past warm-up
    const d = await gql(yoga, `query { state }`) as { state: string }
    expect(d.state).toBe('ready')
    // environmental_context is outside the R 60 governed projection —
    // the LC-500 no longer serves it; the gas analyzer's contract does
    // (its binding is covered in gas-twin.test.ts).
    expect(Object.keys(schema.getQueryType()?.getFields() ?? {})).not.toContain('environmentalContext')
  })
  it('a lying-twin serves the OFFSET indication (the served boundary, spec §8.1)', async () => {
    const { yoga, instrument, clock } = boot('lying-twin')
    clock.advance(400)
    instrument.setLoad(500)
    clock.advance(5)
    const d = await gql(yoga, `query { indication { value } }`) as { indication: { value: number } }
    expect(d.indication.value).toBeCloseTo(500 + 0.25, 1)
  })
  it('instrument-legal operations are mutations (runSelfTest)', async () => {
    const { yoga } = boot()
    const d = await gql(yoga, `mutation { runSelfTest { state } }`) as { runSelfTest: { state: string } }
    expect(d.runSelfTest.state).toBeDefined()
  })
})

describe('checkTwinConformance (the startup gate, law 2)', () => {
  it('a generated schema conforms to its contract (empty diff)', () => {
    const { schema } = boot()
    expect(checkTwinConformance(schema, LC500_CONTRACT)).toEqual([])
  })
  it('a hand-edited schema fails with the diff named', () => {
    const { schema } = boot()
    const tampered = { ...LC500_CONTRACT, serves: [...LC500_CONTRACT.serves, { target: 'flux_capacitance', via: 'get_flux', freshWithinS: 1 }] }
    const diffs = checkTwinConformance(schema, tampered)
    expect(diffs.length).toBeGreaterThan(0)
    expect(diffs.join(' ')).toContain('flux_capacitance')
  })
  it('a contract missing a served register fails too', () => {
    const { schema } = boot()
    const reduced = { ...LC500_CONTRACT, serves: LC500_CONTRACT.serves.filter(s => s.target !== 'state') }
    expect(checkTwinConformance(schema, reduced).join(' ')).toContain('state')
  })
})
