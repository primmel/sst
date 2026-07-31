import { describe, it, expect } from 'vitest'
import { loadCondition, loadProfileAsProgram, buildDryHeatProgram } from '../src/environment/d11-reader.js'
import { resolve, join } from 'node:path'
import { existsSync } from 'node:fs'

const REPO_ROOT = resolve(import.meta.dirname, '..', '..', '..', '..')
const BASE_DIR = join(REPO_ROOT, 'packages', 'base', 'sst-oiml-base')
const hasBase = existsSync(BASE_DIR)

describe('TODO 25 — D 11 file reader', () => {
  it.skipIf(!hasBase)('loads the dry-heat condition from the base package', async () => {
    const cond = await loadCondition(BASE_DIR, 'dry-heat')
    expect(cond).not.toBeNull()
    expect(cond!.id).toBe('dry-heat')
    expect(cond!.kind).toBe('steady')
    expect(cond!.classification).toBe('influence')
    expect(cond!.severity_levels.length).toBeGreaterThan(0)
  })

  it.skipIf(!hasBase)('loads the damp-heat-cyclic-db profile as an EnvironmentalProgram', async () => {
    const prog = await loadProfileAsProgram(BASE_DIR, 'damp-heat-cyclic-db')
    expect(prog).not.toBeNull()
    expect(prog!.keyframes.length).toBe(5)  // 5 keyframes over 24h
    expect(prog!.totalDurationS).toBe(24 * 3600)
    expect(prog!.loop).toBe(true)
    // Keyframe times in seconds
    expect(prog!.keyframes[0]!.atS).toBe(0)
    expect(prog!.keyframes[1]!.atS).toBe(3 * 3600)
  })

  it.skipIf(!hasBase)('builds a dry-heat program at a specific severity level', async () => {
    const prog = await buildDryHeatProgram(BASE_DIR, 2)  // 0-based index 2 = level 3 = 40 °C
    expect(prog).not.toBeNull()
    expect(prog!.keyframes.length).toBe(4)
    expect(prog!.keyframes[1]!.temperatureDegC).toBe(40)
  })

  it('returns null for a non-existent condition', async () => {
    const cond = await loadCondition(BASE_DIR, 'non-existent-condition')
    expect(cond).toBeNull()
  })
})
