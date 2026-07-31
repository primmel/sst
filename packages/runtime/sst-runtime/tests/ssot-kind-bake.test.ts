import { describe, it, expect } from 'vitest'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

const REPO_ROOT = resolve(import.meta.dirname, '..', '..', '..', '..')

describe('TODO 19 — SSOT-driven kind generation (bake script exists)', () => {
  it('the bake script is present at packages/kinds/sst-r60/scripts/bake-kind-from-ssot.ts', () => {
    const path = join(REPO_ROOT, 'packages', 'kinds', 'sst-r60', 'scripts', 'bake-kind-from-ssot.ts')
    expect(existsSync(path)).toBe(true)
  })

  it('the bake script documents its SSOT source path', async () => {
    const { readFile } = await import('node:fs/promises')
    const path = join(REPO_ROOT, 'packages', 'kinds', 'sst-r60', 'scripts', 'bake-kind-from-ssot.ts')
    const text = await readFile(path, 'utf-8')
    expect(text).toContain('smart/data/r60')
    expect(text).toContain('model/instrument.yaml')
    expect(text).toContain('classification.gen.yaml')
  })

  it('the hand-authored classification.yaml is still the source of truth (until re-bake)', () => {
    const handAuthored = join(REPO_ROOT, 'packages', 'kinds', 'sst-r60', 'classification.yaml')
    expect(existsSync(handAuthored)).toBe(true)
  })
})
