// kind-meta.ts — the data layer for the kind-driven bench (TODO 05).
//
// At build time, walk packages/kinds/<kind-id>/bench.yaml and surface
// it to the bench as a typed object. Today the bench reads it directly
// from disk; TODO 02 full execution serves it via the runtime's
// /kind/<id>/bench endpoint.
//
// Status: scaffolded. Provides the typed shape + a loader. Component
// integration (Graph.vue reads graph axes from kind-meta, BenchScene
// HUD reads hud_cells, etc.) is TODO 05's component-side refactor.

import { readFile, readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { existsSync } from 'node:fs'
import { parse } from 'yaml'

// ── The bench.yaml schema (subset of the kind package's bench.yaml) ──

export interface HudCell {
  key: string
  label: string
  channel: 'world' | 'twin'
  format: string                 // Python-style {:.2f} placeholder, applied via fmt()
  source: string                 // dot-path into the ground-truth or indication object
}

export interface IndicationCard {
  channel: 'world' | 'twin'
  source: string
  unit_source?: string
  title: string
  subtitle: string
}

export interface GraphAxis {
  source: string
  label: string
  unit: string
}
export interface GraphLine {
  source: string
  channel: 'world' | 'twin'
  color: 'world' | 'twin'
}
export interface GraphSpec {
  x_axis: GraphAxis
  y_axis: GraphAxis & { auto_scale: boolean; min?: number; max?: number }
  lines: Record<string, GraphLine>   // 'actual' | 'indicated'
  mpe_band: { source: string; color: string }
}

export interface Scene3dDeformation {
  node_substring: string
  squash_by?: string               // expression for the squash factor
  visible_when?: string            // expression for visibility
  scale_by?: string                // expression for the scale factor
  translate_by?: string            // expression for the translation
  rotate_by?: string               // expression for the rotation
  description?: string
}
export interface Scene3dSpec {
  model: string                    // 'instance.model'
  deformations: Scene3dDeformation[]
}

export interface ConsoleGrammarSpec {
  commands: Record<string, { template: string; targets?: string[]; handler?: string }>
}

export interface DialSpec {
  present: boolean
  spec_source?: string             // dot-path into the instance's coefficients
}

export interface KindBenchMeta {
  hud_cells: HudCell[]
  indication_card: IndicationCard
  graph: GraphSpec
  console_grammar: ConsoleGrammarSpec
  dial: DialSpec
  scene_3d: Scene3dSpec
}

// ── Loader ────────────────────────────────────────────────────────────

/** Walk up from cwd to find the repo root (the dir CONTAINING packages/). */
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

/** Read a kind's bench.yaml by kind id (e.g. 'primmel-sst-r60').
 *  Walks packages/kinds/ and matches against the manifest's id field —
 *  directory names don't always equal manifest ids. Returns null if not found. */
export async function loadKindBenchMeta(kindId: string): Promise<KindBenchMeta | null> {
  const kindsDir = join(repoRoot(), 'packages', 'kinds')
  const dir = await readdir(kindsDir).catch(() => [])
  for (const sub of dir) {
    const manifestPath = join(kindsDir, sub, 'package.sst.yaml')
    try {
      const manifest = parse(await readFile(manifestPath, 'utf-8')) as { id?: string }
      if (manifest.id === kindId) {
        const benchPath = join(kindsDir, sub, 'bench.yaml')
        const text = await readFile(benchPath, 'utf-8')
        return parse(text) as KindBenchMeta
      }
    } catch { /* keep scanning */ }
  }
  return null
}

/** Format a value per a Python-style {:.2f} format string. */
export function fmt(format: string, value: number | null | undefined): string {
  if (value == null) return '—'
  // Translate the simple {:.Nf} placeholder to JS. Supports a single
  // placeholder per string (the bench only ever uses one per cell).
  const m = /\{:(\.\d+)?f\}/.exec(format)
  if (!m) return format
  const digits = m[1] ? Number(m[1].slice(1)) : 0
  return format.replace(/\{:(\.\d+)?f\}/, value.toFixed(digits))
}
