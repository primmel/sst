import { describe, it, expect } from 'vitest'
import { resolve, join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { randomBytes } from 'node:crypto'
import { loadPackage } from '../src/package-loader.js'
import { runSession } from '../src/session.js'

const ACME_LC500 = resolve(__dirname, '../../../instances/acme-lc500')
const EPHEMERAL = 0

async function buildZip(srcDir: string, destZip: string): Promise<string> {
  const { execFile } = await import('node:child_process')
  await new Promise<void>((resolveP, rejectP) => {
    const proc = execFile('zip', ['-q', '-X', '-r', destZip, '.'], { cwd: srcDir }, (err) => err ? rejectP(err) : resolveP())
    proc.on('error', rejectP)
  })
  return destZip
}

describe('TODO 24 — runSession boots composed instruments', () => {
  it('boots an HTTP server for the ACME LC-500 instance', async () => {
    const pkg = await loadPackage(ACME_LC500)
    const session = await runSession(pkg, { port: EPHEMERAL, seed: 42 })

    expect(session.instanceId).toBe('acme-lc500')
    expect(session.kindId).toBe('primmel-sst-r60')
    expect(session.url).toMatch(/^http:\/\/localhost:\d+$/)
    expect(session.port).toBeGreaterThan(0)

    await session.close()
  })

  it('the /world endpoint answers GraphQL queries (the world is reality)', async () => {
    const pkg = await loadPackage(ACME_LC500)
    const session = await runSession(pkg, { port: EPHEMERAL, seed: 42 })

    try {
      const res = await fetch(`${session.url}/world`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: '{ clock groundTruth { appliedLoadKg } }' }),
      })
      const json = (await res.json()) as { data?: { clock?: number; groundTruth?: { appliedLoadKg?: number } }; errors?: Array<{ message: string }> }
      expect(json.errors).toBeUndefined()
      expect(json.data?.clock).toBe(0)
      expect(json.data?.groundTruth?.appliedLoadKg).toBe(0)
    } finally {
      await session.close()
    }
  })

  it('the /world mutation placeLoad updates ground truth', async () => {
    const pkg = await loadPackage(ACME_LC500)
    const session = await runSession(pkg, { port: EPHEMERAL, seed: 42 })

    try {
      const res = await fetch(`${session.url}/world`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: 'mutation { placeLoad(massKg: 40) { groundTruth { appliedLoadKg } } }' }),
      })
      const json = (await res.json()) as { data?: { placeLoad?: { groundTruth?: { appliedLoadKg?: number } } } }
      expect(json.data?.placeLoad?.groundTruth?.appliedLoadKg).toBe(40)
    } finally {
      await session.close()
    }
  })

  it('the /twin endpoint answers indication queries (the legal view)', async () => {
    const pkg = await loadPackage(ACME_LC500)
    const session = await runSession(pkg, { port: EPHEMERAL, seed: 42 })

    try {
      // Apply a load first via /world, then read via /twin.
      await fetch(`${session.url}/world`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: 'mutation { placeLoad(massKg: 100) { groundTruth { appliedLoadKg } } }' }),
      })
      // Give the instrument a moment to compute an indication. The
      // server's tick loop isn't running (no bench), so the indication
      // reflects the initial state (0). This still proves /twin answers.
      const res = await fetch(`${session.url}/twin`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: '{ indication { value unit } }' }),
      })
      const json = (await res.json()) as { data?: { indication?: { value?: number; unit?: string } }; errors?: Array<{ message: string }> }
      expect(json.errors).toBeUndefined()
      expect(json.data?.indication?.unit).toBe('kg')
      expect(typeof json.data?.indication?.value).toBe('number')
    } finally {
      await session.close()
    }
  })

  it('throws a helpful error for an unrecognised kind', async () => {
    const pkg = await loadPackage(ACME_LC500)
    // Force an unknown kind by overriding the manifest.
    const badPkg = { ...pkg, manifest: { ...pkg.manifest, kind: 'primmel-sst-r49' } }
    await expect(runSession(badPkg, { port: EPHEMERAL })).rejects.toThrow(/unknown kind 'primmel-sst-r49'/)
  })

  it('boots from a ZIP-uploaded package (the plug-and-play path)', async () => {
    const tempDir = join(tmpdir(), `sst-zip-${randomBytes(8).toString('hex')}`)
    await mkdir(tempDir, { recursive: true })
    const zipPath = join(tempDir, 'acme-lc500.zip')
    try {
      await buildZip(ACME_LC500, zipPath)
      const pkg = await loadPackage(zipPath)
      try {
        const session = await runSession(pkg, { port: EPHEMERAL })
        expect(session.instanceId).toBe('acme-lc500')
        expect(session.kindId).toBe('primmel-sst-r60')

        const res = await fetch(`${session.url}/world`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ query: '{ clock groundTruth { appliedLoadKg } }' }),
        })
        const json = (await res.json()) as { data?: { groundTruth?: { appliedLoadKg?: number } } }
        expect(json.data?.groundTruth?.appliedLoadKg).toBe(0)

        await session.close()
      } finally {
        await pkg.cleanup?.()
      }
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })
})

void fileURLToPath // satisfy import (kept for future use)
void dirname
