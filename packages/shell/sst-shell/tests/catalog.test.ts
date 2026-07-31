import { describe, it, expect } from 'vitest'
import { buildCatalog } from '../src/lib/catalog.js'

describe('@primmel/sst-shell — catalog builder', () => {
  it('walks the packages directory and finds all four kinds', async () => {
    const { kinds } = await buildCatalog()
    const ids = kinds.map(k => k.id).sort()
    expect(ids).toEqual(['primmel-sst-r129', 'primmel-sst-r144', 'primmel-sst-r60', 'primmel-sst-r91'])
  })

  it('finds all four ACME instances and binds each to its kind', async () => {
    const { kinds, instances } = await buildCatalog()
    expect(instances.map(i => i.id).sort()).toEqual(['acme-cgm-200', 'acme-lc500', 'acme-md3xx', 'acme-rs180'])

    const r60 = kinds.find(k => k.id === 'primmel-sst-r60')
    expect(r60?.instances.map(i => i.id)).toContain('acme-lc500')

    const r144 = kinds.find(k => k.id === 'primmel-sst-r144')
    expect(r144?.instances.map(i => i.id)).toContain('acme-cgm-200')
  })

  it('every instance carries at least a fresh sample', async () => {
    const { instances } = await buildCatalog()
    for (const inst of instances) {
      expect(inst.samples.map(s => s.name), `${inst.id} samples`).toContain('fresh')
    }
  })

  it('every kind has the required manifest fields', async () => {
    const { kinds } = await buildCatalog()
    for (const k of kinds) {
      expect(k.title, `${k.id} title`).toBeTruthy()
      expect(k.activeDomain, `${k.id} activeDomain`).toBeTruthy()
      expect(k.oimlRecommendation, `${k.id} oimlRecommendation`).toMatch(/^oiml-r\d+$|^unknown$/)
    }
  })
})
