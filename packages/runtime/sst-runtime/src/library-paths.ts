// library-paths.ts — the ONE resolution for where the instrument
// library lives (the split, TODO.integration/24): the kinds +
// instances are SST packages in oimlsmart/sst-instruments.
//
//   1. SST_LIBRARY_PATH (explicit wins — CI, custom layouts)
//   2. the sibling checkouts (../../../oimlsmart/sst-instruments,
//      ../../sst-instruments — the documented side-by-side layout)
//   3. in-repo (the pre-split shape; the runtime's own repo carrying
//      the library — still valid for a monorepo checkout)

import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const RUNTIME_ROOT = resolve(HERE, '..', '..', '..')

export interface LibraryPaths {
  kindsDir: string
  instancesDir: string
  /** Where the library was found (for boot logs and honest errors). */
  origin: 'env' | 'sibling' | 'in-repo'
}

function libraryAt(root: string): LibraryPaths | null {
  const kindsDir = join(root, 'packages', 'kinds')
  const instancesDir = join(root, 'packages', 'instances')
  return existsSync(kindsDir) && existsSync(instancesDir)
    ? { kindsDir, instancesDir, origin: 'sibling' }
    : null
}

export function resolveLibraryPaths(): LibraryPaths {
  const env = process.env.SST_LIBRARY_PATH
  if (env) {
    const kindsDir = join(env, 'packages', 'kinds')
    const instancesDir = join(env, 'packages', 'instances')
    if (existsSync(kindsDir) && existsSync(instancesDir)) {
      return { kindsDir, instancesDir, origin: 'env' }
    }
    throw new Error(`SST_LIBRARY_PATH=${env} carries no packages/kinds + packages/instances`)
  }
  for (const candidate of [
    resolve(RUNTIME_ROOT, '..', 'sst-instruments'),
    resolve(RUNTIME_ROOT, '..', '..', 'sst-instruments'),
    resolve(RUNTIME_ROOT, '..', '..', '..', 'oimlsmart', 'sst-instruments'),
  ]) {
    const found = libraryAt(candidate)
    if (found) return found
  }
  return {
    kindsDir: join(RUNTIME_ROOT, 'packages', 'kinds'),
    instancesDir: join(RUNTIME_ROOT, 'packages', 'instances'),
    origin: 'in-repo',
  }
}
