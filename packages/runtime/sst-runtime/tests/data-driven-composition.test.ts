import { describe, it, expect } from 'vitest'
import { VirtualClock } from '@primmel/sst-runtime/time'
import {
  DataDrivenComposer,
  loadPhysicsChain,
  type PhysicsChainDecl,
} from '../src/stages/data-driven.js'
import { listStages } from '../src/stages/registry.js'
import { ComposedInstrument } from '../src/stages/composer.js'
import { resolve } from 'node:path'

const R60_CHAIN_PATH = resolve(__dirname, '../../../kinds/sst-r60/physics-chain.yaml')

const COEFFS = {
  capacity_kg: 500,
  scale_interval_kg: 0.05,
  sensitivity_mVperV: 2.0,
  gauge_factor: 2.0,
  excitation_V: 10,
  tc_zero_per_degC: 0.0001,
  tc_span_per_degC: 0.0002,
  barometric_per_kPa: 0.00005,
  reference_temp_degC: 20,
  reference_pressure_kPa: 101.325,
  filter_tau_s: 1.0,
  linearization_error_kg: 0.01,
  compensation_residual_per_degC: 0.0005,
  noise_sigma_kg: 0.005,
  thermal_hysteresis_per_degC: 0.00002,
  thermal_hysteresis_tau_s: 3600,
}

const COMPRESSION_DIGITAL = {
  construction: 'column',
  technology: 'strain-gauge',
  stack: 'digital',
}

describe('TODO 23 — data-driven stage composition', () => {
  it('registers the R 60 stages on import (the OCP seam)', () => {
    const keys = listStages()
    expect(keys).toContain('r60/mechanical-compression')
    expect(keys).toContain('r60/mechanical-shear-beam')
    expect(keys).toContain('r60/mechanical-bending-beam')
    expect(keys).toContain('r60/transduction-strain-gauge')
    expect(keys).toContain('r60/conditioning-digital')
    expect(keys).toContain('r60/conditioning-digital-processing')
    expect(keys).toContain('r60/conditioning-analog-active')
    expect(keys).toContain('r60/conditioning-analog-passive')
  })

  it('loads the R 60 physics-chain.yaml from disk', () => {
    const chain = loadPhysicsChain(R60_CHAIN_PATH)
    expect(chain.stages.length).toBeGreaterThan(0)
    // The chain declares one stage per position (1=mechanical, 2=transduction, 3=conditioning)
    const positions = new Set(chain.stages.map((s) => s.position))
    expect(positions.has(1)).toBe(true)
    expect(positions.has(2)).toBe(true)
    expect(positions.has(3)).toBe(true)
  })

  it('resolves the correct stages for a compression/digital classification', () => {
    const chain = loadPhysicsChain(R60_CHAIN_PATH)
    const composer = new DataDrivenComposer(chain, COMPRESSION_DIGITAL, COEFFS, 42)
    expect(composer.chainKeys()).toEqual([
      'r60/mechanical-compression',
      'r60/transduction-strain-gauge',
      'r60/conditioning-digital',
    ])
  })

  it('resolves the shear-beam mechanical stage when classification asks for it', () => {
    const chain = loadPhysicsChain(R60_CHAIN_PATH)
    const composer = new DataDrivenComposer(
      chain,
      { construction: 'shear-beam', technology: 'strain-gauge', stack: 'digital' },
      COEFFS,
      42,
    )
    expect(composer.chainKeys()[0]).toBe('r60/mechanical-shear-beam')
  })

  it('throws when no stage at a position matches the classification', () => {
    const chain: PhysicsChainDecl = {
      stages: [
        {
          key: 'r60/mechanical-compression',
          position: 1,
          applies_to_constructions: ['column', 'canister'],
          consumes: { applied_load_kg: 'float' },
          produces: { strain_mm: 'float' },
        },
      ],
    }
    expect(() => {
      new DataDrivenComposer(
        chain,
        { construction: 'bending-beam', technology: 'strain-gauge', stack: 'digital' },
        COEFFS,
        42,
      )
    }).toThrow(/no stage at position 1 matches/)
  })

  it('pipes data through the chain end-to-end (applied_load_kg → indication_kg)', () => {
    const chain = loadPhysicsChain(R60_CHAIN_PATH)
    const composer = new DataDrivenComposer(chain, COMPRESSION_DIGITAL, COEFFS, 42)
    const out = composer.tick(
      { applied_load_kg: 200 },
      { dtS: 0.1, env: { temperatureDegC: 20, humidityPercentRh: 50, pressureKPa: 101.325 }, nowS: 0 },
    )
    // After 1 tick with a 200 kg load, the chain should produce a finite indication
    expect(typeof out['indication_kg']).toBe('number')
    expect(Number.isFinite(out['indication_kg']!)).toBe(true)
  })

  it('ComposedInstrument uses the data-driven path when physicsChain is provided', () => {
    const chain = loadPhysicsChain(R60_CHAIN_PATH)
    const clock = new VirtualClock()
    const inst = new ComposedInstrument({
      classification: COMPRESSION_DIGITAL,
      coefficients: COEFFS,
      physicsChain: chain,
    }, clock, 42)

    inst.placeMass(200)
    // Tick enough times for the filter to settle. The ComposedInstrument
    // self-subscribes to clock advances (composer.ts:84), so clock.advance
    // drives the chain — no separate .tick() call.
    for (let i = 0; i < 50; i++) {
      clock.advance(0.1)
    }
    const ind = inst.indication()
    expect(ind.unit).toBe('kg')
    expect(Number.isFinite(ind.value)).toBe(true)
    expect(ind.value).not.toBe(0)  // a load was applied; the chain produced a signal
  })

  it('the data-driven path produces the same first-order behaviour as the legacy path', () => {
    // The data-driven and legacy paths both compose the same three R 60
    // stages with the same coefficients. They should produce comparable
    // indications for the same load. We don't assert exact equality
    // (RNG draws may differ slightly), but they should be within a
    // tight tolerance.
    const chain = loadPhysicsChain(R60_CHAIN_PATH)
    const coeffsA = { ...COEFFS, noise_sigma_kg: 0 }  // zero noise for determinism
    const coeffsB = { ...COEFFS, noise_sigma_kg: 0 }

    const clockA = new VirtualClock()
    const clockB = new VirtualClock()
    const dataDriven = new ComposedInstrument({
      classification: COMPRESSION_DIGITAL,
      coefficients: coeffsA,
      physicsChain: chain,
    }, clockA, 42)
    const legacy = new ComposedInstrument({
      classification: COMPRESSION_DIGITAL,
      coefficients: coeffsB,
    }, clockB, 42)

    dataDriven.placeMass(200)
    legacy.placeMass(200)
    // Both ComposedInstrument instances self-subscribe to their clocks
    // (composer.ts:84); advancing the clock drives both signal chains
    // in lockstep. No explicit .tick() — that would double-tick.
    for (let i = 0; i < 50; i++) {
      clockA.advance(0.1)
      clockB.advance(0.1)
    }
    expect(Math.abs(dataDriven.indication().value - legacy.indication().value)).toBeLessThan(1e-6)
  })
})
