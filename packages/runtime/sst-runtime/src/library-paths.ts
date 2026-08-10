// library-paths.ts — the ONE resolution for where the instrument
// library lives (the split, TODO.integration/24): the kinds +
// instances are SST packages in the oimlsmart/sst repo.
//
// The library's position is always DECLARED, never guessed:
//
//   1. SST_LIBRARY_PATH (the explicit declaration — CI sets it to the
//      workflow's checkout position; custom layouts set it)
//   2. the instance's own tree (the `run <instance>` boot: a path
//      inside <root>/packages/instances/<name> means <root> IS the
//      library — the instance lives IN its library; structural, not a
//      checkout-name assumption)
//   3. in-repo (the monorepo shape: the runtime's own repo carrying
//      packages/kinds + packages/instances — structural again)
//
// There is deliberately NO sibling-directory probing: a neighbouring
// checkout's name is a local accident, not a declaration.

import { existsSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
/** The runtime REPO root (src → sst-runtime → runtime → packages → repo). */
const REPO_ROOT = resolve(HERE, '..', '..', '..', '..')

export interface LibraryPaths {
  kindsDir: string
  instancesDir: string
  /** Where the library was found (for boot logs and honest errors). */
  origin: 'env' | 'instance' | 'in-repo'
}

function libraryAt(root: string, origin: LibraryPaths['origin']): LibraryPaths | null {
  const kindsDir = join(root, 'packages', 'kinds')
  const instancesDir = join(root, 'packages', 'instances')
  return existsSync(kindsDir) && existsSync(instancesDir)
    ? { kindsDir, instancesDir, origin }
    : null
}

/** The library containing one instance package: a path inside
 *  <root>/packages/instances/<name> means <root> is the library (when it
 *  also carries packages/kinds). Null otherwise. */
export function libraryForInstance(instancePath: string): LibraryPaths | null {
  const abs = resolve(instancePath)
  const needle = `packages${sep}instances${sep}`
  const i = abs.indexOf(needle)
  if (i < 0) return null
  return libraryAt(abs.slice(0, i), 'instance')
}

export function resolveLibraryPaths(opts?: { instancePath?: string }): LibraryPaths {
  const env = process.env.SST_LIBRARY_PATH
  if (env) {
    const kindsDir = join(env, 'packages', 'kinds')
    const instancesDir = join(env, 'packages', 'instances')
    if (existsSync(kindsDir) && existsSync(instancesDir)) {
      return { kindsDir, instancesDir, origin: 'env' }
    }
    throw new Error(`SST_LIBRARY_PATH=${env} carries no packages/kinds + packages/instances`)
  }
  // The instance's own tree (the `run <instance>` boot): the instance
  // lives IN its library.
  if (opts?.instancePath) {
    const own = libraryForInstance(opts.instancePath)
    if (own) return own
  }
  const inRepo = libraryAt(REPO_ROOT, 'in-repo')
  if (inRepo) return inRepo
  throw new Error(
    'no SST instrument library declared — set SST_LIBRARY_PATH to the library checkout ' +
    '(a tree with packages/kinds + packages/instances), or boot with `run <instance>` ' +
    'where the instance sits inside its library tree',
  )
}
