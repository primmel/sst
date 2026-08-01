import { describe, it, expect } from 'vitest'
import { loadKindBenchMeta, fmt } from '../src/lib/kind-meta.js'

describe('@primmel/sst-bench — kind-meta loader (TODO 05 scaffolding)', () => {
  it('loads the R 60 kind package bench.yaml', async () => {
    const meta = await loadKindBenchMeta('primmel-sst-r60')
    expect(meta).not.toBeNull()
    expect(meta!.hud_cells.length).toBeGreaterThan(0)
    expect(meta!.indication_card.title).toContain('/twin')
    expect(meta!.graph.lines).toHaveProperty('actual')
    expect(meta!.graph.lines).toHaveProperty('indicated')
    expect(meta!.scene_3d.deformations.length).toBeGreaterThan(0)
    expect(meta!.dial.present).toBe(true)
  })

  it('every hud cell has the required fields', async () => {
    const meta = await loadKindBenchMeta('primmel-sst-r60')
    for (const cell of meta!.hud_cells) {
      expect(cell.key).toBeTruthy()
      expect(cell.label).toBeTruthy()
      expect(cell.format).toBeTruthy()
      expect(cell.source).toBeTruthy()
      expect(['world', 'twin']).toContain(cell.channel)
    }
  })

  it('loads the R 91, R 129, R 144 kind bench.yaml too', async () => {
    for (const kind of ['primmel-sst-r91', 'primmel-sst-r129', 'primmel-sst-r144']) {
      const meta = await loadKindBenchMeta(kind)
      expect(meta, `${kind} bench.yaml`).not.toBeNull()
      expect(meta!.hud_cells.length, `${kind} hud_cells`).toBeGreaterThan(0)
    }
  })

  it('returns null for an unknown kind', async () => {
    const meta = await loadKindBenchMeta('primmel-sst-r999')
    expect(meta).toBeNull()
  })
})

describe('@primmel/sst-bench — kind-meta fmt helper', () => {
  it('formats a fixed-point value', () => {
    expect(fmt('{:.2f} kg', 40.05)).toBe('40.05 kg')
    expect(fmt('{:.0f} s', 300)).toBe('300 s')
    expect(fmt('{:.1f} °C', 20.5)).toBe('20.5 °C')
  })
  it('returns the placeholder text for null values', () => {
    expect(fmt('{:.2f} kg', null)).toBe('—')
    expect(fmt('{:.2f} kg', undefined)).toBe('—')
  })
  it('passes through format strings without placeholders', () => {
    expect(fmt('hello', 1)).toBe('hello')
  })
})
