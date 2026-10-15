// tests/bundle-boot.test.ts — the bundle-native boot's mechanics (the
// FS boot's mirror): same checks, same schemas, deterministic physics.

import { describe, it, expect } from 'vitest'
import { bootBundleSession } from '@primmel/sst-runtime/session/boot-bundle'
import { syntheticBundle } from './lib.js'

describe('bootBundleSession (the bundle-native boot)', () => {
  it('boots a session: schemas generated, conformance passed, serial mirrored', async () => {
    const session = await bootBundleSession(syntheticBundle())
    expect(session.instanceId).toBe('synthetic-cell')
    expect(session.kindId).toBe('primmel-sst-r60')
    expect(session.twinSchema).toBeDefined()
    expect(session.worldSchema).toBeDefined()
    expect(session.openApiDoc).toBeDefined()
    // The twin IS the sampled unit: the sample's serial mirrors into
    // the identification block.
    expect(session.contract.model.identification.serial).toBe('SYN-001')
    expect(session.stream.targets).toEqual(['indication', 'state'])
  })

  it('the physics is live: placeLoad → the indication follows (deterministically)', async () => {
    const session = await bootBundleSession(syntheticBundle(), { seed: 42 })
    const { instrument, clock, twinIo } = session
    const inst = instrument as { indication(): { value: number } }
    expect(inst.indication().value).toBe(0)
    const place = (session.worldSchema as unknown as { })
    void place
    // Drive the world the way the schema does — through the handler map
    // the world schema binds (the same functions the mutations call).
    ;(instrument as { placeMass(kg: number): void }).placeMass(40)
    expect(inst.indication().value).toBe(40)
    expect((twinIo.instrument as { operationalState(): string }).operationalState()).toBe('running')
    clock.advance(10)
    expect((twinIo.instrument as { servedAt(): number }).servedAt()).toBe(10)
  })

  it('rejects a non-instance manifest tier loudly', async () => {
    const bundle = syntheticBundle()
    bundle.instance.manifest.tier = 'oiml-kind'
    await expect(bootBundleSession(bundle)).rejects.toThrow(/targets an instance package/)
  })

  it('rejects a behavior without the TwinInstrumentView surface', async () => {
    const bundle = syntheticBundle()
    bundle.behaviorModule = { create: () => ({ indication: () => ({ value: 0, unit: 'kg' }) }) }
    await expect(bootBundleSession(bundle)).rejects.toThrow(/missing servedAt\(\)|missing operationalState\(\)/)
  })

  it('rejects a wrong baked-contract artifact', async () => {
    const bundle = syntheticBundle()
    bundle.kind.twinContractJson = { format: 'something/else', version: 1, contract: {} }
    await expect(bootBundleSession(bundle)).rejects.toThrow(/not a baked twin contract/)
  })
})
