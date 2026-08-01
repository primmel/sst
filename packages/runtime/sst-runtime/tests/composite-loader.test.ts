// tests/composite-loader.test.ts — the composite package loader leg
// (TODO.integration/03). Verifies the loader accepts composite manifests
// and rejects each schema-violation class with a precise message.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadPackage } from '../src/package-loader.js'

function makeComposite(dir: string, manifest: object): string {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'package.sst.yaml'), yaml(manifest))
  return dir
}

function yaml(obj: object): string {
  // Minimal YAML emitter — the manifests are simple enough that a JSON
  // superset works for these tests.
  return JSON.stringify(obj, null, 2)
}

describe('the composite package loader leg (specs/13 §5)', () => {
  let tmpRoot: string

  beforeEach(() => {
    tmpRoot = join(tmpdir(), `sst-composite-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  })
  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true })
  })

  it('a valid composite manifest loads', async () => {
    const dir = makeComposite(join(tmpRoot, 'good'), {
      sst_version: '1.0',
      tier: 'primmel-instance',
      id: 'good-composite',
      title: 'good composite',
      composition: {
        components: { a: { instance: './a' }, b: { instance: './b' } },
        decomposition: {
          foo: 'a.foo',
          bar: 'b.bar',
          operationalState: '<computed>.state_rule',
        },
        state_rule: 'any_fault_else_analyzer',
      },
    })
    const pkg = await loadPackage(dir)
    expect(pkg.manifest.composition).toBeDefined()
    expect(Object.keys(pkg.manifest.composition!.components)).toEqual(['a', 'b'])
    expect(pkg.manifest.composition!.state_rule).toBe('any_fault_else_analyzer')
  })

  it('rejects an unknown state rule', async () => {
    const dir = makeComposite(join(tmpRoot, 'bad-rule'), {
      sst_version: '1.0',
      tier: 'primmel-instance',
      id: 'bad-rule',
      title: 'bad',
      composition: {
        components: { a: { instance: './a' } },
        decomposition: { foo: 'a.x' },
        state_rule: 'made_up_rule',
      },
    })
    await expect(loadPackage(dir)).rejects.toThrow(/must be equal to one of the allowed values/)
  })

  it('rejects an untotal decomposition (same source mapped twice)', async () => {
    const dir = makeComposite(join(tmpRoot, 'bad-dup'), {
      sst_version: '1.0',
      tier: 'primmel-instance',
      id: 'bad-dup',
      title: 'bad',
      composition: {
        components: { a: { instance: './a' }, b: { instance: './b' } },
        decomposition: { foo: 'a.x', bar: 'a.x' },
        state_rule: 'any_fault_else_analyzer',
      },
    })
    await expect(loadPackage(dir)).rejects.toThrow(/decomposition source 'a\.x' is mapped to multiple composite registers/)
  })

  it('rejects a decomposition value with an unknown component', async () => {
    const dir = makeComposite(join(tmpRoot, 'bad-comp'), {
      sst_version: '1.0',
      tier: 'primmel-instance',
      id: 'bad-comp',
      title: 'bad',
      composition: {
        components: { a: { instance: './a' } },
        decomposition: { foo: 'nonexistent.x' },
        state_rule: 'any_fault_else_analyzer',
      },
    })
    await expect(loadPackage(dir)).rejects.toThrow(/references unknown component 'nonexistent'/)
  })

  it('rejects a coupling that references an unknown component', async () => {
    const dir = makeComposite(join(tmpRoot, 'bad-coupling'), {
      sst_version: '1.0',
      tier: 'primmel-instance',
      id: 'bad-coupling',
      title: 'bad',
      composition: {
        components: { a: { instance: './a' } },
        decomposition: { foo: 'a.x' },
        state_rule: 'any_fault_else_analyzer',
        couplings: [{ from: 'nope.x', to: 'a.y' }],
      },
    })
    await expect(loadPackage(dir)).rejects.toThrow(/coupling nope\.x references unknown component 'nope'/)
  })

  it('rejects a primmel-instance manifest with neither kind nor composition', async () => {
    const dir = makeComposite(join(tmpRoot, 'bad-empty'), {
      sst_version: '1.0',
      tier: 'primmel-instance',
      id: 'bad-empty',
      title: 'bad',
    })
    await expect(loadPackage(dir)).rejects.toThrow(/manifest validation failed/)
  })

  it('the canonical acme-cgm-system composite loads', async () => {
    // The repo's real composite package — end-to-end check.
    const pkg = await loadPackage(join(__dirname, '..', '..', '..', 'instances', 'acme-cgm-system'))
    expect(pkg.manifest.id).toBe('acme-cgm-system')
    expect(pkg.manifest.composition).toBeDefined()
    expect(pkg.manifest.composition!.state_rule).toBe('any_fault_else_analyzer')
    expect(Object.keys(pkg.manifest.composition!.components).sort()).toEqual(['analyzer', 'sampling_line'])
  })
})
