import { describe, it, expect, afterEach } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createSimServer } from '@primmel/sst-runtime/server'
import { buildWorldSchema, type WorldContext } from '@primmel/sst-runtime/world-schema'
import { generateTwinSchema } from '@primmel/sst-runtime/twin-schema'
import { LC500_CONTRACT } from '@primmel/sst-runtime/twin-contract'
import { VirtualClock } from '@primmel/sst-runtime/time'
import { SimulatedInstrument } from '@primmel/sst-runtime/instrument'
import { getScenario } from '@primmel/sst-runtime/scenario'
import { fetchGroundTruth, fetchIndication, gql, isUnauthorized, setWorldToken, clearWorldToken, worldToken } from './api.js'
import { dialSvg, needleAngleDeg } from './dial.js'
import { LC500_PAIRED_DIAL } from '@primmel/sst-runtime/instrument'
import { pointerPositionKg } from '@primmel/sst-runtime/physics/stages/dial'

const run = promisify(execFile)
const BENCH_DIR = join(dirname(fileURLToPath(import.meta.url)), '..')
const DIST = join(BENCH_DIR, 'dist')

let close: (() => Promise<void>) | undefined
afterEach(async () => { await close?.(); close = undefined })

describe('@primmel/sst-bench (spec §9/§10)', () => {
  it('astro build produces the servable SPA', async () => {
    if (!existsSync(DIST)) {
      await run('npx', ['astro', 'build'], { cwd: BENCH_DIR, timeout: 120000 })
    }
    expect(existsSync(join(DIST, 'index.html'))).toBe(true)
  }, 130000)

  it('the sim serves the bench at / and the channels beside it', async () => {
    const clock = new VirtualClock()
    const host: WorldContext = {
      instrument: new SimulatedInstrument(getScenario('good-cell'), clock, 1),
      clock,
      swap(def) { this.instrument = new SimulatedInstrument(def, clock, 1) },
    }
    const server = await createSimServer({
      worldSchema: buildWorldSchema(host),
      twinSchema: generateTwinSchema(LC500_CONTRACT, { instrument: host.instrument, clock }),
      benchDir: DIST,
      port: 0,
      title: 'LC-500 bench test',
    })
    close = server.close
    const res = await fetch(`${server.url}/`)
    expect(res.status).toBe(200)
    const html = await res.text()
    expect(html).toContain('terminal-input')
    expect(html).toContain('pane-dial') // the paired passive indicator rides the bench
    // the channels still work beside the bench
    const gt = await fetchGroundTruth(server.url)
    expect(gt.appliedLoadKg).toBe(0)
    const ind = await fetchIndication(server.url)
    expect(ind.indication.unit).toBe('kg')
  }, 30000)

  it('the dial pane renders its scale and the needle tracks a known load', () => {
    // The scale: one tick per graduation (101), numbered majors every
    // ten (0…500 step 50), the declared graduation + uncertainty caption.
    const svg = dialSvg(LC500_PAIRED_DIAL)
    expect(svg.match(/class="tick minor/g)).toHaveLength(90)
    expect(svg.match(/class="tick major/g)).toHaveLength(11)
    expect(svg.match(/class="dial-num"/g)).toHaveLength(11)
    expect(svg).toContain('>500</text>')
    expect(svg).toContain('graduation 5 kg — read to ±2.5 kg')
    // The needle: a known 40 kg load rests on the 40 kg graduation at
    // its sweep angle; half scale points straight up (270° of sweep).
    expect(pointerPositionKg(LC500_PAIRED_DIAL, 40)).toBeCloseTo(40, 12)
    expect(needleAngleDeg(LC500_PAIRED_DIAL, 40)).toBeCloseTo(135 + (40 / 500) * 270, 9)
    expect(needleAngleDeg(LC500_PAIRED_DIAL, 250)).toBeCloseTo(270, 9)
    expect(needleAngleDeg(LC500_PAIRED_DIAL, 500)).toBeCloseTo(405, 9)
  })

  it('api.gql posts to a channel and unwraps data', async () => {
    const clock = new VirtualClock()
    const host: WorldContext = {
      instrument: new SimulatedInstrument(getScenario('good-cell'), clock, 1),
      clock,
      swap(def) { this.instrument = new SimulatedInstrument(def, clock, 1) },
    }
    const server = await createSimServer({ worldSchema: buildWorldSchema(host), port: 0 })
    close = server.close
    const d = await gql(server.url, '/world', `mutation { placeLoad(massKg: 40) { groundTruth { appliedLoadKg } } }`) as { placeLoad: { groundTruth: { appliedLoadKg: number } } }
    expect(d.placeLoad.groundTruth.appliedLoadKg).toBe(40)
  }, 30000)

  it('guarded /world: gql without the token is rejected; the stored token lands the mutation; queries stay open', async () => {
    // a tab-scoped storage shim — the SPA runs this in sessionStorage
    const mem = new Map<string, string>()
    ;(globalThis as { sessionStorage?: unknown }).sessionStorage = {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => void mem.set(k, v),
      removeItem: (k: string) => void mem.delete(k),
    }
    try {
      const clock = new VirtualClock()
      const host: WorldContext = {
        instrument: new SimulatedInstrument(getScenario('good-cell'), clock, 1),
        clock,
        swap(def) { this.instrument = new SimulatedInstrument(def, clock, 1) },
      }
      const server = await createSimServer({ worldSchema: buildWorldSchema(host), port: 0, worldToken: 's3cret-world-token' })
      close = server.close
      const rejected = await gql(server.url, '/world', `mutation { placeLoad(massKg: 40) { clock } }`)
      expect(isUnauthorized(rejected)).toBe(true)
      setWorldToken('s3cret-world-token')
      expect(worldToken()).toBe('s3cret-world-token')
      const d = await gql(server.url, '/world', `mutation { placeLoad(massKg: 40) { groundTruth { appliedLoadKg } } }`) as { placeLoad: { groundTruth: { appliedLoadKg: number } } }
      expect(isUnauthorized(d)).toBe(false)
      expect(d.placeLoad.groundTruth.appliedLoadKg).toBe(40)
      // queries never needed the token
      clearWorldToken()
      expect(worldToken()).toBeUndefined()
      const gt = await fetchGroundTruth(server.url)
      expect(gt.appliedLoadKg).toBe(40)
    } finally {
      delete (globalThis as { sessionStorage?: unknown }).sessionStorage
    }
  }, 30000)
})
