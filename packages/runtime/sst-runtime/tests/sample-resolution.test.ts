// tests/sample-resolution.test.ts — boot sample selection prefers an
// EXACT name match: with samples/creep-fail.yaml and
// samples/creep-fail-001.yaml both declared (the LC-500's creep-fail
// variant family), the boot ref "creep-fail" resolves creep-fail.yaml —
// never the longer name that merely contains it, regardless of manifest
// order. The substring match remains as the fallback for partial refs
// ("aged" → samples/aged-2024.yaml).

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { readSampleSerial } from '../src/kinds/definition-builder.js'
import type { LoadedPackage } from '../src/package-loader.js'

let root = ''

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'sst-sample-resolution-'))
  await mkdir(join(root, 'samples'), { recursive: true })
  await writeFile(join(root, 'samples', 'creep-fail.yaml'), 'sample_name: creep-fail\nserial_number: LC500-002\n')
  await writeFile(join(root, 'samples', 'creep-fail-001.yaml'), 'sample_name: creep-fail-001\nserial_number: LC500-001\n')
  await writeFile(join(root, 'samples', 'aged-2024.yaml'), 'sample_name: aged-2024\nserial_number: LC500-007\n')
})

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

const fixture = (samples: string[]): LoadedPackage => ({
  manifest: {
    sst_version: '1.0',
    tier: 'primmel-instance',
    id: 'sample-resolution-fixture',
    title: 'sample resolution fixture',
    samples,
  },
  tier: 'primmel-instance',
  rootPath: root,
})

describe('sample resolution prefers exact names over substring matches', () => {
  it('"creep-fail" resolves creep-fail.yaml even when creep-fail-001 is declared first', async () => {
    const instance = fixture(['samples/creep-fail-001.yaml', 'samples/creep-fail.yaml', 'samples/aged-2024.yaml'])
    expect(await readSampleSerial(instance, 'creep-fail')).toBe('LC500-002')
  })

  it('"creep-fail-001" resolves the stamped variant', async () => {
    const instance = fixture(['samples/creep-fail.yaml', 'samples/creep-fail-001.yaml'])
    expect(await readSampleSerial(instance, 'creep-fail-001')).toBe('LC500-001')
  })

  it('a partial ref still rides the substring fallback ("aged" → aged-2024)', async () => {
    const instance = fixture(['samples/creep-fail.yaml', 'samples/aged-2024.yaml'])
    expect(await readSampleSerial(instance, 'aged')).toBe('LC500-007')
  })
})
