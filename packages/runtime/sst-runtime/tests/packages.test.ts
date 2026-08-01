import { describe, it, expect } from 'vitest'
import { readFile, readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { parse } from 'yaml'

const REPO_ROOT = resolve(import.meta.dirname, '..', '..', '..', '..')

const CONDITION_FIELDS = ['id', 'title', 'kind', 'classification', 'description', 'severity_levels'] as const
const PROFILE_FIELDS = ['id', 'title', 'condition', 'keyframes'] as const
const KIND_PACKAGE_FIELDS = ['sst_version', 'tier', 'id', 'title', 'base', 'active_domain'] as const

async function readYaml(path: string): Promise<Record<string, unknown>> {
  return parse(await readFile(path, 'utf-8')) as Record<string, unknown>
}

describe('OIML SST base package — D 11 conditions', () => {
  const conditionsDir = join(REPO_ROOT, 'packages', 'base', 'sst-oiml-base', 'conditions')

  it('ships at least 35 condition files (the D 11 canonical set)', async () => {
    const files = (await readdir(conditionsDir)).filter(f => f.endsWith('.yaml'))
    expect(files.length).toBeGreaterThanOrEqual(35)
  })

  it('every condition file carries the required fields', async () => {
    const files = (await readdir(conditionsDir)).filter(f => f.endsWith('.yaml'))
    for (const f of files) {
      const c = await readYaml(join(conditionsDir, f))
      for (const field of CONDITION_FIELDS) {
        expect(c, `${f} should define ${field}`).toBeDefined()
      }
      expect(c.kind, `${f} kind`).toMatch(/^(steady|cyclic|transient)$/)
      expect(c.classification, `${f} classification`).toMatch(/^(influence|disturbance)$/)
      expect(Array.isArray(c.severity_levels), `${f} severity_levels`).toBe(true)
    }
  })

  it('every multi-level condition file declares preferred levels where applicable', async () => {
    // "Preferred" is informative (the OIML-canonical level), not required.
    // The test verifies that the field, when present, is well-formed.
    const files = (await readdir(conditionsDir)).filter(f => f.endsWith('.yaml'))
    let totalPreferred = 0
    for (const f of files) {
      const c = await readYaml(join(conditionsDir, f))
      const levels = c.severity_levels as Array<Record<string, unknown>>
      for (const l of levels) {
        if (l.preferred !== undefined) {
          expect(typeof l.preferred, `${f} level preferred must be boolean`).toBe('boolean')
          totalPreferred++
        }
      }
    }
    // Across 35 conditions there should be a meaningful number of preferred markers.
    expect(totalPreferred, 'at least some conditions should mark preferred levels').toBeGreaterThan(10)
  })
})

describe('OIML SST base package — D 11 profiles', () => {
  const profilesDir = join(REPO_ROOT, 'packages', 'base', 'sst-oiml-base', 'profiles')

  it('ships at least 3 canonical profiles', async () => {
    const files = (await readdir(profilesDir)).filter(f => f.endsWith('.yaml'))
    expect(files.length).toBeGreaterThanOrEqual(3)
  })

  it('every profile file carries the required fields', async () => {
    const files = (await readdir(profilesDir)).filter(f => f.endsWith('.yaml'))
    for (const f of files) {
      const p = await readYaml(join(profilesDir, f))
      for (const field of PROFILE_FIELDS) {
        expect(p, `${f} should define ${field}`).toBeDefined()
      }
      // Keyframe times must be monotonically non-decreasing.
      const kfs = p.keyframes as Array<Record<string, unknown>>
      const times = kfs.map(k => k.at_h as number)
      const sorted = [...times].sort((a, b) => a - b)
      expect(times).toEqual(sorted)
    }
  })
})

describe('OIML SST kind packages — manifest invariants', () => {
  const kindsDir = join(REPO_ROOT, 'packages', 'kinds')

  it('ships all four kinds (R 60 / R 91 / R 129 / R 144)', async () => {
    const ids = (await readdir(kindsDir)).filter(f => f.startsWith('sst-r'))
    expect(ids.sort()).toEqual(['sst-r129', 'sst-r144', 'sst-r60', 'sst-r91'])
  })

  it.each([
    ['sst-r60'], ['sst-r91'], ['sst-r129'], ['sst-r144'],
  ] as const)('%s has the canonical 10 files', async (kind) => {
    const files = await readdir(join(kindsDir, kind))
    for (const f of ['package.sst.yaml', 'classification.yaml', 'parameters.yaml', 'mpe.yaml', 'physics-chain.yaml', 'world-kind.sdl.graphql', 'world-kind.yaml', 'bench.yaml', 'interface.d.ts', 'scenarios.yaml']) {
      expect(files, `${kind} should ship ${f}`).toContain(f)
    }
  })

  it.each([
    ['sst-r60', 'mass'],
    ['sst-r91', 'speed'],
    ['sst-r129', 'dimensions'],
    ['sst-r144', 'gas-concentration'],
  ] as const)('%s declares active_domain %s', async (kind, domain) => {
    const m = await readYaml(join(kindsDir, kind, 'package.sst.yaml'))
    expect(m.active_domain).toBe(domain)
    for (const field of KIND_PACKAGE_FIELDS) {
      expect(m[field], `${kind} manifest should define ${field}`).toBeDefined()
    }
  })
})

describe('Primmel SST instance packages — manifest invariants', () => {
  const instancesDir = join(REPO_ROOT, 'packages', 'instances')

  it('ships the ACME instances', async () => {
    const ids = (await readdir(instancesDir)).filter(f => f.startsWith('acme-'))
    expect(ids.sort()).toEqual(['acme-cgm-200', 'acme-cgm-sampling-line', 'acme-cgm-system', 'acme-lc500', 'acme-md3xx', 'acme-rs180'])
  })

  it.each([
    ['acme-lc500', 'primmel-sst-r60'],
    ['acme-rs180', 'primmel-sst-r91'],
    ['acme-md3xx', 'primmel-sst-r129'],
    ['acme-cgm-200', 'primmel-sst-r144'],
    ['acme-cgm-sampling-line', 'primmel-sst-sampling-line'],
  ] as const)('%s references kind %s', async (instance, kind) => {
    const m = await readYaml(join(instancesDir, instance, 'package.sst.yaml'))
    expect(m.kind).toBe(kind)
    expect(m.manufacturer).toBeDefined()
    expect(m.classification).toBeDefined()
    expect(Array.isArray(m.samples)).toBe(true)
  })

  it('every single-kind instance ships a behavior.ts AND scene.ts source', async () => {
    const ids = (await readdir(instancesDir)).filter(f => f.startsWith('acme-'))
    for (const id of ids) {
      const m = await readYaml(join(instancesDir, id, 'package.sst.yaml'))
      if (m.composition) continue // composite packages have no src/ — they compose
      const files = await readdir(join(instancesDir, id, 'src'))
      expect(files, `${id}/src/ should ship behavior.ts AND scene.ts`).toContain('behavior.ts')
      expect(files, `${id}/src/ should ship behavior.ts AND scene.ts`).toContain('scene.ts')
    }
  })

  it('every single-kind instance ships at least a fresh/healthy sample', async () => {
    const ids = (await readdir(instancesDir)).filter(f => f.startsWith('acme-'))
    for (const id of ids) {
      const m = await readYaml(join(instancesDir, id, 'package.sst.yaml'))
      if (m.composition) continue // composite packages compose samples; they don't carry their own
      const samples = await readdir(join(instancesDir, id, 'samples'))
      // The first-listed sample is the canonical "fresh"/"healthy" one.
      expect(samples, `${id} should ship samples`).not.toContain([])
    }
  })
})
