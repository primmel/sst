import { describe, it, expect } from 'vitest'
import { resolve } from 'node:path'
import { loadPackage } from '../src/package-loader.js'
import { runSession } from '../src/session.js'
import { hasBehavior, loadBehavior } from '../src/kinds/behavior-loader.js'
import { buildInstanceDefinition } from '../src/kinds/definition-builder.js'
import { VirtualClock } from '../src/time.js'

const INSTANCES = resolve(__dirname, '../../../instances')
const EPHEMERAL = 0

describe('plug-and-play behavior.js loading', () => {
  it('hasBehavior detects all four shipped instances', () => {
    for (const id of ['acme-lc500', 'acme-rs180', 'acme-md3xx', 'acme-cgm-200']) {
      expect(hasBehavior(resolve(INSTANCES, id))).toBe(true)
    }
  })

  it('loadBehavior loads create() from acme-lc500', async () => {
    const b = await loadBehavior(resolve(INSTANCES, 'acme-lc500'), 'behavior.js')
    expect(typeof b.create).toBe('function')
    expect(b.sourcePath).toContain('behavior')
  })

  it('buildInstanceDefinition produces id + classification + coefficients', async () => {
    const pkg = await loadPackage(resolve(INSTANCES, 'acme-lc500'))
    const def = await buildInstanceDefinition({
      instance: pkg,
      coefficients: { capacity_kg: 500, sensitivity_mVperV: 2.0 },
      classification: { construction: 'column', technology: 'strain-gauge', stack: 'digital' },
    })
    expect(def.id).toBe('acme-lc500')
    expect(def.stack).toBe('digital')
    expect((def.coefficients as Record<string, number>).capacity_kg).toBe(500)
    expect((def.classification as Record<string, string>).construction).toBe('column')
  })

  it('runSession boots acme-lc500 via behavior.js (plug-and-play path)', async () => {
    const pkg = await loadPackage(resolve(INSTANCES, 'acme-lc500'))
    const session = await runSession(pkg, { port: EPHEMERAL, seed: 42 })
    try {
      expect(session.kindId).toBe('primmel-sst-r60')
      // Twin indication works
      const twin = await fetch(`${session.url}/twin`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: '{ indication { value unit } state }' }),
      })
      const body = await twin.json() as { data?: { indication?: { unit: string }; state?: string }; errors?: unknown[] }
      expect(body.errors).toBeUndefined()
      expect(body.data?.indication?.unit).toBe('kg')
      // World mutation via kind handlers (placeMass on ComposedInstrument)
      const world = await fetch(`${session.url}/world`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: 'mutation { placeLoad(massKg: 40) { groundTruth { appliedLoadKg } } }' }),
      })
      const wbody = await world.json() as { data?: { placeLoad?: { groundTruth?: { appliedLoadKg: number } } }; errors?: unknown[] }
      expect(wbody.errors).toBeUndefined()
      expect(wbody.data?.placeLoad?.groundTruth?.appliedLoadKg).toBe(40)
    } finally {
      await session.close()
    }
  })

  it('runSession boots all four kinds via behavior.js end-to-end', async () => {
    const cases = [
      { id: 'acme-lc500', kind: 'primmel-sst-r60', twinQuery: '{ indication { unit } }', twinCheck: (d: any) => d.indication?.unit === 'kg' },
      { id: 'acme-rs180', kind: 'primmel-sst-r91', twinQuery: '{ state }', twinCheck: (d: any) => typeof d.state === 'string' },
      { id: 'acme-md3xx', kind: 'primmel-sst-r129', twinQuery: '{ indicationLength { unit } }', twinCheck: (d: any) => d.indicationLength?.unit === 'cm' },
      { id: 'acme-cgm-200', kind: 'primmel-sst-r144', twinQuery: '{ indicationCo { unit } }', twinCheck: (d: any) => typeof d.indicationCo?.unit === 'string' && d.indicationCo.unit.length > 0 },
    ]
    for (const c of cases) {
      const pkg = await loadPackage(resolve(INSTANCES, c.id))
      const session = await runSession(pkg, { port: EPHEMERAL, seed: 7 })
      try {
        expect(session.kindId).toBe(c.kind)
        const res = await fetch(`${session.url}/twin`, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ query: c.twinQuery }),
        })
        const body = await res.json() as { data?: unknown; errors?: unknown[] }
        expect(body.errors, `${c.id} twin errors`).toBeUndefined()
        expect(c.twinCheck(body.data), `${c.id} twin check`).toBe(true)
      } finally {
        await session.close()
      }
    }
  })

  it('loadBehavior rejects a module without create()', async () => {
    // Point at a directory that has no behavior — should throw.
    await expect(loadBehavior(resolve(INSTANCES, '..'))).rejects.toThrow(/no behavior module/)
  })
})
