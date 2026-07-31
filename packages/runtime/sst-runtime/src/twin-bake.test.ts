import { describe, it, expect } from 'vitest'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseTwinContract, parseDurationS } from './twin-contract-prl.js'
import { bakeTwinContract, loadBakedContract } from './twin-bake.js'
import { LC500_CONTRACT } from './twin-contract.js'
import { generateTwinSchema } from './twin-schema.js'
import { checkTwinConformance } from './conformance.js'
import { createSimServer } from './server.js'
import { buildWorldSchema, type WorldContext } from './world-schema.js'
import { VirtualClock } from './time.js'
import { SimulatedInstrument } from './instrument.js'
import { getScenario } from './scenario.js'

// The acme-lc500 product package lives in the (private) oimlsmart/smart
// checkout; override with SIM_ACME_LC500. CI runs without it — the
// adapter legs skip then (the R60_PACKAGE precedent from primmel-ts);
// the baked-artifact legs below run everywhere.
const R60_PKG = process.env.SIM_ACME_LC500 ?? '/Users/mulgogi/src/oimlsmart/smart/primmel-packages/acme-lc500'
const HAS_PKG = existsSync(R60_PKG)

describe('parseTwinContract (the build-time adapter)', () => {
  it('the real acme-lc500 package parses to exactly the canonical fixture', { skip: !HAS_PKG, timeout: 30000 }, async () => {
    const contract = await parseTwinContract(R60_PKG)
    expect(contract).toEqual(LC500_CONTRACT)
  })
  it('parseDurationS handles the shorthand + ISO forms', () => {
    expect(parseDurationS('5s')).toBe(5)
    expect(parseDurationS('500ms')).toBe(0.5)
    expect(parseDurationS('1min')).toBe(60)
    expect(parseDurationS('PT1M')).toBe(60)
    expect(parseDurationS('1h')).toBe(3600)
    expect(parseDurationS('P1D')).toBe(86400)
  })
})

describe('the baked contract (standalone posture, spec §9)', () => {
  it('bake → load round-trips; a zero-SMART boot serves the twin with conformance', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sim-bake-'))
    try {
      const file = join(dir, 'lc500.twin.json')
      await bakeTwinContract(LC500_CONTRACT, file, R60_PKG)
      const contract = await loadBakedContract(file)
      expect(contract).toEqual(LC500_CONTRACT)

      // zero-SMART boot: only the baked artifact — no .prl, no primmel-ts import
      const clock = new VirtualClock()
      const host: WorldContext = {
        instrument: new SimulatedInstrument(getScenario('good-cell'), clock, 1),
        clock,
        swap(def) { this.instrument = new SimulatedInstrument(def, clock, 1) },
      }
      const twinSchema = generateTwinSchema(contract, { instrument: host.instrument, clock })
      expect(checkTwinConformance(twinSchema, contract)).toEqual([])
      const server = await createSimServer({ worldSchema: buildWorldSchema(host), twinSchema, port: 0, title: 'LC-500 (baked)' })
      try {
        const res = await fetch(`${server.url}/twin`, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ query: `{ indication { value unit servedAt } }` }),
        })
        const body = await res.json() as { data: { indication: { value: number; unit: string } } }
        expect(body.data.indication.unit).toBe('kg')
      } finally {
        await server.close()
      }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }, 30000)
})
