// catalog.ts — at build time, walk the packages/ directory and build a
// list of (kind, instance) pairs the shell can render. Each kind lists
// its instances; each instance lists its samples. The data is read from
// the package.sst.yaml manifests directly (no runtime needed).
//
// TODO 02 full execution swaps this for HTTP calls to the runtime's
// /kinds and /instances endpoints. Static-generation gives us a working
// shell today with zero runtime dep.

import { readdir, readFile, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { readFile as readFileAsync, readdir as readdirAsync } from 'node:fs/promises'
import { parse } from 'yaml'

export interface KindEntry {
  id: string
  title: string
  activeDomain: string
  oimlRecommendation: string
  instances: InstanceEntry[]
}

export interface InstanceEntry {
  id: string
  title: string
  manufacturer: { id: string; name: string; shortName?: string; country: string }
  kindId: string
  samples: Array<{ name: string; path: string }>
}

interface Manifest {
  id?: string
  title?: string
  active_domain?: string
  maps_to?: string
  oiml_recommendation?: { id?: string }
  kind?: string
  manufacturer?: { id?: string; name?: string; shortName?: string; country?: string }
  samples?: string[]
}

/** Walk up from cwd to find the repo root (the dir containing packages/kinds/). */
function findRepoRoot(): string {
  let dir = process.cwd()
  for (let i = 0; i < 10; i++) {
    if (existsSync(join(dir, 'packages', 'kinds'))) return dir
    const parent = resolve(dir, '..')
    if (parent === dir) break
    dir = parent
  }
  return process.cwd()
}

let _repoRoot: string | undefined
function repoRoot(): string {
  if (!_repoRoot) _repoRoot = findRepoRoot()
  return _repoRoot
}

async function readManifest(path: string): Promise<Manifest | null> {
  try {
    const text = await readFileAsync(path, 'utf-8')
    return parse(text) as Manifest
  } catch { return null }
}

/** Walk packages/kinds/ and packages/instances/ and return the gallery data. */
export async function buildCatalog(): Promise<{ kinds: KindEntry[]; instances: InstanceEntry[] }> {
  const kindsDir = join(repoRoot(), 'packages', 'kinds')
  const instancesDir = join(repoRoot(), 'packages', 'instances')

  const kindIds = await readdirAsync(kindsDir).catch(() => [])
  const instanceIds = await readdirAsync(instancesDir).catch(() => [])

  const kinds: KindEntry[] = []
  const instances: InstanceEntry[] = []

  for (const kid of kindIds) {
    const manifest = await readManifest(join(kindsDir, kid, 'package.sst.yaml'))
    if (!manifest) continue
    kinds.push({
      id: manifest.id ?? kid,
      title: manifest.title ?? kid,
      activeDomain: manifest.active_domain ?? 'unknown',
      oimlRecommendation: manifest.oiml_recommendation?.id ?? manifest.maps_to ?? 'unknown',
      instances: [],
    })
  }

  for (const iid of instanceIds) {
    const manifest = await readManifest(join(instancesDir, iid, 'package.sst.yaml'))
    if (!manifest || !manifest.kind) continue
    const samples = (manifest.samples ?? []).map(s => ({
      name: s.replace(/^samples\//, '').replace(/\.yaml$/, ''),
      path: s,
    }))
    const entry: InstanceEntry = {
      id: manifest.id ?? iid,
      title: manifest.title ?? iid,
      manufacturer: {
        id: manifest.manufacturer?.id ?? 'unknown',
        name: manifest.manufacturer?.name ?? 'Unknown',
        shortName: manifest.manufacturer?.shortName,
        country: manifest.manufacturer?.country ?? '??',
      },
      kindId: manifest.kind,
      samples,
    }
    instances.push(entry)
    const kind = kinds.find(k => k.id === entry.kindId)
    if (kind) kind.instances.push(entry)
  }

  return { kinds, instances }
}

// Suppress unused-import warnings for the sync fs imports (used by findRepoRoot).
void readdir
void readFile
