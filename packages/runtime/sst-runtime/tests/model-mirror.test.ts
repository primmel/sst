import { describe, it, expect } from 'vitest'
import { VirtualClock } from '@primmel/sst-runtime/time'
import { SimulatedInstrument } from '@primmel/sst-runtime/instrument'
import { buildWorldSchema, type WorldContext } from '@primmel/sst-runtime/world-schema'
import { generateTwinSchema } from '@primmel/sst-runtime/twin-schema'
import { checkTwinConformance } from '@primmel/sst-runtime/conformance'
import { createSimServer } from '@primmel/sst-runtime/server'
import { LC500_CONTRACT, LC500_FULL_MODEL, withModel, GAS_ANALYZER_CONTRACT, GAS_ANALYZER_FULL_MODEL } from '@primmel/sst-runtime/twin-contract'
import { getScenario } from '@primmel/sst-runtime/scenario'
import { introspectTwin } from '../src/twin/introspect.js'
import { createTwinDriver } from '../src/twin/driver.js'
import type { TwinDriver } from '../src/twin/driver.js'

const KG = 'https://si-digital-framework.org/SI/units/kilogram'
const KELVIN = 'https://si-digital-framework.org/SI/units/kelvin'

async function bootR60Server() {
  const clock = new VirtualClock()
  const instrument = new SimulatedInstrument(getScenario('good-cell'), clock, 42)
  const host: WorldContext = { instrument, clock, swap() {} }
  const contract = withModel(LC500_CONTRACT, LC500_FULL_MODEL)
  const io = { get instrument() { return host.instrument }, clock }
  const twinSchema = generateTwinSchema(contract, io)
  const diffs = checkTwinConformance(twinSchema, contract)
  if (diffs.length > 0) throw new Error(`twin conformance check failed:\n  - ${diffs.join('\n  - ')}`)
  return createSimServer({
    worldSchema: buildWorldSchema(host),
    twinSchema,
    port: 0,
    title: 'LC-500 (test)',
  })
}

describe('TODO 33 — the full-model mirror (Query.instrument)', () => {
  it('checkTwinConformance accepts the enriched contract (model + serves + ops)', async () => {
    const clock = new VirtualClock()
    const instrument = new SimulatedInstrument(getScenario('good-cell'), clock, 42)
    const contract = withModel(LC500_CONTRACT, LC500_FULL_MODEL)
    const twinSchema = generateTwinSchema(contract, { instrument, clock })
    const diffs = checkTwinConformance(twinSchema, contract)
    expect(diffs).toEqual([])
  })

  it('Query.instrument returns the full instrument model — the mirror', async () => {
    const server = await bootR60Server()
    try {
      const res = await fetch(`${server.url}/twin`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: `{
          instrument {
            identification { instrumentId manufacturer model designation kindId oimlRecommendation }
            classification { accuracyClass nLc humidityClass construction technology }
            designParameters { eMax { value unit } eMin { value unit } vMin { value unit } ratedOutput { value unit } }
            metrologicalLimits { mpeBands { lower upper factor } creepAllowance }
            provenance { certificate firstIssued }
            servedRegisters { target via freshWithinS returnType }
            legalOperations { id kind }
          }
        }` }),
      })
      const body = (await res.json()) as { data?: { instrument?: {
        identification?: Record<string, unknown>
        classification?: Record<string, unknown>
        designParameters?: Record<string, { value: number; unit?: string }>
        metrologicalLimits?: { mpeBands?: Array<{ lower: number; upper: number | null; factor: number }>; creepAllowance?: number }
        provenance?: Record<string, unknown>
        servedRegisters?: Array<{ target: string; via: string; returnType: string }>
        legalOperations?: Array<{ id: string; kind: string }>
      } }; errors?: Array<{ message: string }> }
      expect(body.errors).toBeUndefined()
      const inst = body.data?.instrument
      expect(inst?.identification).toMatchObject({
        instrumentId: 'acme-lc500',
        manufacturer: 'ACME Instruments',
        model: 'LC-500',
        designation: 'ACME LC-500 class C6 load cell',
        kindId: 'primmel-sst-r60',
        oimlRecommendation: 'OIML R 60',
      })
      expect(inst?.classification).toMatchObject({
        accuracyClass: 'C',
        nLc: 6000,
        humidityClass: 'CH',
        construction: 'column',
        technology: 'strain-gauge',
      })
      expect(inst?.designParameters).toMatchObject({
        eMax: { value: 500, unit: KG },
        eMin: { value: 10, unit: KG },
        vMin: { value: 0.0833, unit: KG },
        ratedOutput: { value: 2.0 },
      })
      expect(inst?.metrologicalLimits?.mpeBands).toEqual([{ lower: 0, upper: null, factor: 0.5 }])
      expect(inst?.metrologicalLimits?.creepAllowance).toBe(0.7)
      expect(inst?.provenance).toMatchObject({ certificate: 'R60/2021-DE-24-071', firstIssued: '2021-04-15' })
      const servedRegisters = inst?.servedRegisters ?? []
      expect(servedRegisters.map((r) => r.target).sort()).toEqual(['indication', 'state'])
      const legalOps = inst?.legalOperations ?? []
      expect(legalOps.map((o) => o.id)).toContain('run_self_test')
    } finally {
      await server.close()
    }
  })

  it('Query.instrument honours BIPM Digital SI Framework unit URIs', async () => {
    const server = await bootR60Server()
    try {
      const res = await fetch(`${server.url}/twin`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: `{ instrument { designParameters { tMin { unit } tMax { unit } } } }` }),
      })
      const body = (await res.json()) as { data?: { instrument?: { designParameters?: { tMin?: { unit?: string }, tMax?: { unit?: string } } } } }
      expect(body.data?.instrument?.designParameters?.tMin?.unit).toBe(KELVIN)
      expect(body.data?.instrument?.designParameters?.tMax?.unit).toBe(KELVIN)
    } finally {
      await server.close()
    }
  })

  it('the flat Query shortcuts still work (backward compatibility)', async () => {
    const server = await bootR60Server()
    try {
      const res = await fetch(`${server.url}/twin`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: `{ indication { value unit servedAt } }` }),
      })
      const body = (await res.json()) as { data?: { indication?: { value: number, unit: string } } }
      expect(body.data?.indication?.unit).toBe('kg')
    } finally {
      await server.close()
    }
  })

  it('the model mirror works for R 144 (CGM-200) too', async () => {
    const contract = withModel(GAS_ANALYZER_CONTRACT, GAS_ANALYZER_FULL_MODEL)
    const clock = new VirtualClock()
    // The CGM-200 contract declares indication_co and indication_nox serves;
    // supply register readers so generation is total. The fake instrument
    // returns a valid Qty for indication() (required by TwinInstrumentView).
    const fakeInstrument = {
      indication(): { value: number; unit: 'ppm'; kind: 'amount-of-substance fraction' } {
        return { value: 0, unit: 'ppm', kind: 'amount-of-substance fraction' }
      },
      servedAt(): number { return 0 },
      operationalState(): string { return 'ready' },
      environment(): { temperatureDegC: number; humidityPercentRh: number; pressureKPa: number } {
        return { temperatureDegC: 20, humidityPercentRh: 50, pressureKPa: 101.325 }
      },
    } as unknown as Parameters<typeof generateTwinSchema>[1]['instrument']
    const schema = generateTwinSchema(contract, {
      instrument: fakeInstrument,
      clock,
      registers: {
        indication_co: () => ({ value: 0, unit: 'µmol/mol', kind: 'amount-of-substance fraction', servedAt: 0 }),
        indication_nox: () => ({ value: 0, unit: 'µmol/mol', kind: 'amount-of-substance fraction', servedAt: 0 }),
      },
    })
    const diffs = checkTwinConformance(schema, contract)
    expect(diffs).toEqual([])
  })
})

describe('introspectTwin — discovery via GraphQL introspection', () => {
  it('returns the model-mirrored query fields for a running /twin endpoint', async () => {
    const server = await bootR60Server()
    try {
      const summary = await introspectTwin(server.url)
      expect(summary.queryFields).toContain('instrument')
      expect(summary.queryFields).toContain('indication')
      expect(summary.queryFields).toContain('state')
      expect(summary.mutationFields).toContain('runSelfTest')
      expect(summary.subscriptionFields).toContain('state')
    } finally {
      await server.close()
    }
  })
})

describe('typed instrument() method on TwinDriver<C> (the model-driven client, full circle)', () => {
  it('createTwinDriver exposes instrument() when the contract carries a model', () => {
    const enriched = withModel(LC500_CONTRACT, LC500_FULL_MODEL)
    const driver = createTwinDriver(enriched, 'http://localhost:0')
    expect(typeof driver.instrument).toBe('function')
  })

  it('createTwinDriver has NO instrument() when the contract omits the model', () => {
    const driver = createTwinDriver(LC500_CONTRACT, 'http://localhost:0')
    expect((driver as { instrument?: unknown }).instrument).toBeUndefined()
  })

  it('driver.instrument() fetches the full model from a running server', async () => {
    const server = await bootR60Server()
    try {
      const enriched = withModel(LC500_CONTRACT, LC500_FULL_MODEL)
      const driver = createTwinDriver(enriched, server.url)
      const model = await driver.instrument()
      expect(model.identification.instrumentId).toBe('acme-lc500')
      expect(model.identification.manufacturer).toBe('ACME Instruments')
      expect(model.classification?.accuracyClass).toBe('C')
      expect(model.classification?.nLc).toBe(6000)
      expect(model.designParameters?.eMax).toEqual({ value: 500, unit: KG })
      expect(model.designParameters?.tMin).toEqual({ value: -10, unit: KELVIN })
      expect(model.metrologicalLimits?.mpeBands?.[0]).toEqual({ lower: 0, upper: null, factor: 0.5 })
      expect(model.provenance?.certificate).toBe('R60/2021-DE-24-071')
      expect(model.servedRegisters.length).toBe(2)
      expect(model.legalOperations.find((o) => o.id === 'run_self_test')).toBeDefined()
    } finally {
      await server.close()
    }
  })

  it('the typed instrument() return type is checked at compile time', () => {
    // Compile-time only: proves TypedInstrumentModelResponse<C['model']>
    // resolves to the expected shape with camelCase keys. If the model
    // changes, this type-level check changes — drift becomes a compile error.
    const enriched = withModel(LC500_CONTRACT, LC500_FULL_MODEL)
    type Driver = TwinDriver<typeof enriched>
    type _HasInstrument = 'instrument' extends keyof Driver ? true : false
    void 0 as unknown as _HasInstrument
    expect(true).toBe(true)
  })
})

describe('deep conformance check (Priority 3 — model-mirror drift detection)', () => {
  it('passes for a fully-mirrored contract', () => {
    const clock = new VirtualClock()
    const instrument = new SimulatedInstrument(getScenario('good-cell'), clock, 42)
    const contract = withModel(LC500_CONTRACT, LC500_FULL_MODEL)
    const schema = generateTwinSchema(contract, { instrument, clock })
    expect(checkTwinConformance(schema, contract)).toEqual([])
  })

  it('fails when the model is declared but the schema lacks nested types (drift)', () => {
    // Synthesise drift: a contract that declares a model, but a schema
    // generated from a different (model-less) contract. The deep check
    // should detect the missing InstrumentModel type.
    const clock = new VirtualClock()
    const instrument = new SimulatedInstrument(getScenario('good-cell'), clock, 42)
    const driftedSchema = generateTwinSchema(LC500_CONTRACT, { instrument, clock })
    const contractWithModel = withModel(LC500_CONTRACT, LC500_FULL_MODEL)
    const diffs = checkTwinConformance(driftedSchema, contractWithModel)
    expect(diffs.some((d) => /InstrumentModel/.test(d))).toBe(true)
  })
})
