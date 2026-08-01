import { describe, it, expect } from 'vitest'
import { loadPackage } from '../src/package-loader.js'
import { listKinds, lookupKind } from '../src/kinds/registry.js'
import { resolve } from 'node:path'

const REPO_ROOT = resolve(import.meta.dirname, '..', '..', '..', '..')

const PACKAGES = [
  'packages/base/sst-oiml-base',
  'packages/kinds/sst-r60',
  'packages/kinds/sst-r91',
  'packages/kinds/sst-r129',
  'packages/kinds/sst-r144',
  'packages/instances/acme-lc500',
  'packages/instances/acme-rs180',
  'packages/instances/acme-md3xx',
  'packages/instances/acme-cgm-200',
] as const

describe('@primmel/sst-runtime — package loader', () => {
  it('loads every known package without error', async () => {
    for (const rel of PACKAGES) {
      const pkg = await loadPackage(resolve(REPO_ROOT, rel))
      expect(pkg.manifest.id, `${rel} manifest id`).toMatch(/^[a-z][a-z0-9-]*$/)
      expect(pkg.manifest.tier, `${rel} tier`).toMatch(/^(oiml-base|oiml-kind|primmel-instance)$/)
    }
  })

  it('rejects a non-existent package source', async () => {
    await expect(loadPackage('/does/not/exist')).rejects.toThrow(/not found/)
  })

  it('rejects a path without a manifest', async () => {
    await expect(loadPackage(resolve(REPO_ROOT, 'packages/runtime'))).rejects.toThrow(/no package\.sst\.yaml/)
  })
})

describe('@primmel/sst-runtime — kind-interface registry', () => {
  it('lists the shipped kinds', () => {
    const ids = listKinds().map(k => k.kindId).sort()
    expect(ids).toEqual(['primmel-sst-r129', 'primmel-sst-r144', 'primmel-sst-r60', 'primmel-sst-r91', 'primmel-sst-sampling-line'])
  })

  it.each([
    ['primmel-sst-r60', 'mass'],
    ['primmel-sst-r91', 'speed'],
    ['primmel-sst-r129', 'dimensions'],
    ['primmel-sst-r144', 'gas-concentration'],
    ['primmel-sst-sampling-line', 'sample-transport'],
  ] as const)('%s has active domain %s', (kindId, domain) => {
    expect(lookupKind(kindId).activeDomain).toBe(domain)
  })

  it('throws on unknown kind lookup', () => {
    expect(() => lookupKind('primmel-sst-r999')).toThrow(/unknown kind/)
  })
})
