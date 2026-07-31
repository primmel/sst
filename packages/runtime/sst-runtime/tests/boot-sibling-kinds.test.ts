import { describe, it, expect } from 'vitest'
import { resolve } from 'node:path'
import { loadPackage } from '../src/package-loader.js'
import { runSession } from '../src/session.js'

const INSTANCES_DIR = resolve(__dirname, '../../../instances')
const EPHEMERAL = 0

describe('TODO 33 — sibling kinds boot via the strategy registry', () => {
  it('R 144 (gas analyzer) boots via the runSession boot path', async () => {
    const pkg = await loadPackage(resolve(INSTANCES_DIR, 'acme-cgm-200'))
    const session = await runSession(pkg, { port: EPHEMERAL, seed: 42 })

    try {
      expect(session.kindId).toBe('primmel-sst-r144')
      expect(session.instanceId).toBe('acme-cgm-200')

      // The gas analyzer exposes per-component indication registers
      // (camelCased per the schema generator).
      const res = await fetch(`${session.url}/twin`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: `{ indicationCo { value unit } }` }),
      })
      const body = (await res.json()) as { data?: { indicationCo?: { value: number; unit: string } }; errors?: Array<{ message: string }> }
      expect(body.errors).toBeUndefined()
      expect(body.data?.indicationCo?.unit).toBe('ppm')
    } finally {
      await session.close()
    }
  })

  it('R 91 (radar) boots via the runSession boot path', async () => {
    const pkg = await loadPackage(resolve(INSTANCES_DIR, 'acme-rs180'))
    const session = await runSession(pkg, { port: EPHEMERAL, seed: 42 })

    try {
      expect(session.kindId).toBe('primmel-sst-r91')
      expect(session.instanceId).toBe('acme-rs180')

      const res = await fetch(`${session.url}/twin`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: `{ state }` }),
      })
      const body = (await res.json()) as { data?: { state?: string }; errors?: Array<{ message: string }> }
      expect(body.errors).toBeUndefined()
      expect(typeof body.data?.state).toBe('string')
    } finally {
      await session.close()
    }
  })

  it('R 129 (dimensioner) boots via the runSession boot path', async () => {
    const pkg = await loadPackage(resolve(INSTANCES_DIR, 'acme-md3xx'))
    const session = await runSession(pkg, { port: EPHEMERAL, seed: 42 })

    try {
      expect(session.kindId).toBe('primmel-sst-r129')
      expect(session.instanceId).toBe('acme-md3xx')

      // The dimensioner exposes per-dimension indication registers
      // (camelCased per the schema generator).
      const res = await fetch(`${session.url}/twin`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: `{ indicationLength { value unit } }` }),
      })
      const body = (await res.json()) as { data?: { indicationLength?: { value: number; unit: string } }; errors?: Array<{ message: string }> }
      expect(body.errors).toBeUndefined()
      expect(body.data?.indicationLength?.unit).toBe('cm')
    } finally {
      await session.close()
    }
  })

  it('all four kinds carry the model mirror via Query.instrument', async () => {
    const instancePaths = [
      { dir: 'acme-lc500',   kindId: 'primmel-sst-r60',  expectedManufacturer: 'ACME Instruments' },
      { dir: 'acme-cgm-200', kindId: 'primmel-sst-r144', expectedManufacturer: 'ACME Instruments' },
      { dir: 'acme-rs180',   kindId: 'primmel-sst-r91',  expectedManufacturer: undefined },
      { dir: 'acme-md3xx',   kindId: 'primmel-sst-r129', expectedManufacturer: undefined },
    ]

    for (const { dir, kindId, expectedManufacturer } of instancePaths) {
      const pkg = await loadPackage(resolve(INSTANCES_DIR, dir))
      const session = await runSession(pkg, { port: EPHEMERAL, seed: 42 })
      try {
        expect(session.kindId).toBe(kindId)
        const res = await fetch(`${session.url}/twin`, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ query: `{ instrument { identification { instrumentId kindId ${expectedManufacturer ? 'manufacturer' : ''} } servedRegisters { target } } }` }),
        })
        const body = (await res.json()) as { data?: { instrument?: { identification: { instrumentId: string; kindId: string; manufacturer?: string }; servedRegisters: Array<{ target: string }> } }; errors?: Array<{ message: string }> }
        expect(body.errors).toBeUndefined()
        expect(body.data?.instrument?.identification?.instrumentId).toBe(pkg.manifest.id)
        expect(body.data?.instrument?.identification?.kindId).toBe(kindId)
        if (expectedManufacturer !== undefined) {
          expect(body.data?.instrument?.identification?.manufacturer).toBe(expectedManufacturer)
        }
        // Every kind has at least one served register
        expect(body.data?.instrument?.servedRegisters.length).toBeGreaterThan(0)
      } finally {
        await session.close()
      }
    }
  })
})
