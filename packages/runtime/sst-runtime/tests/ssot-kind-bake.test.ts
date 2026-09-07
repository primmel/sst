import { describe, it, expect } from 'vitest'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { KINDS_DIR } from './lib.js'

describe('TODO 19 — SSOT-driven kind generation (bake script exists)', () => {
  it('the bake script is present at packages/kinds/sst-r60/scripts/bake-kind-from-ssot.ts', () => {
    const path = join(KINDS_DIR, 'sst-r60', 'scripts', 'bake-kind-from-ssot.ts')
    expect(existsSync(path)).toBe(true)
  })

  it('the bake script documents its SSOT source path', async () => {
    const { readFile } = await import('node:fs/promises')
    const path = join(KINDS_DIR, 'sst-r60', 'scripts', 'bake-kind-from-ssot.ts')
    const text = await readFile(path, 'utf-8')
    expect(text).toContain('data/r60')
    expect(text).toContain('model/instrument.yaml')
    expect(text).toContain('classification_dimensions')
  })

  it('classification.yaml is the bannered GENERATED output (the freshness leg re-bakes and diffs)', async () => {
    const { readFile } = await import('node:fs/promises')
    const generated = join(KINDS_DIR, 'sst-r60', 'classification.yaml')
    expect(existsSync(generated)).toBe(true)
    const text = await readFile(generated, 'utf-8')
    expect(text).toContain('AUTO-GENERATED')
    expect(text).toContain('classification_dimensions')
  })
})
