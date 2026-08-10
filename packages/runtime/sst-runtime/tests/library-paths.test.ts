// tests/library-paths.test.ts — the library resolution order:
// env (explicit) → the instance's own tree (the `run <instance>` boot)
// → the documented sibling checkouts → in-repo.

import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { resolveLibraryPaths, libraryForInstance } from '../src/library-paths.js'

function makeLibrary(): { root: string; instanceDir: string } {
  const root = mkdtempSync(join(tmpdir(), 'sst-lib-'))
  mkdirSync(join(root, 'packages', 'kinds'), { recursive: true })
  const instanceDir = join(root, 'packages', 'instances', 'acme-demo')
  mkdirSync(instanceDir, { recursive: true })
  return { root, instanceDir }
}

describe('libraryForInstance', () => {
  it('resolves the library from an instance path inside its tree', () => {
    const { root, instanceDir } = makeLibrary()
    try {
      const lib = libraryForInstance(instanceDir)
      expect(lib).not.toBeNull()
      expect(lib!.origin).toBe('instance')
      expect(lib!.kindsDir).toBe(join(root, 'packages', 'kinds'))
      expect(lib!.instancesDir).toBe(join(root, 'packages', 'instances'))
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('answers null for a path outside any packages/instances tree', () => {
    expect(libraryForInstance('/tmp/nowhere/at-all')).toBeNull()
  })
})

describe('resolveLibraryPaths({ instancePath })', () => {
  afterEach(() => { delete process.env.SST_LIBRARY_PATH })

  it('the env still wins over the instance tree', () => {
    const envLib = makeLibrary()
    const instLib = makeLibrary()
    process.env.SST_LIBRARY_PATH = envLib.root
    try {
      const lib = resolveLibraryPaths({ instancePath: instLib.instanceDir })
      expect(lib.origin).toBe('env')
      expect(lib.kindsDir).toBe(join(envLib.root, 'packages', 'kinds'))
    } finally {
      rmSync(envLib.root, { recursive: true, force: true })
      rmSync(instLib.root, { recursive: true, force: true })
    }
  })

  it('the instance tree beats the sibling dance when no env is set', () => {
    delete process.env.SST_LIBRARY_PATH
    const { root, instanceDir } = makeLibrary()
    try {
      const lib = resolveLibraryPaths({ instancePath: instanceDir })
      expect(lib.origin).toBe('instance')
      expect(lib.kindsDir).toBe(join(root, 'packages', 'kinds'))
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
