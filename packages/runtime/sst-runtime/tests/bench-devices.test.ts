// tests/bench-devices.test.ts — the climatic chamber and the indicating
// instrument: the environmental and readout halves of R 60-2, 2.7.2's
// "basic equipment" (the force machine has its own file).

import { describe, it, expect } from 'vitest'
import { ClimaticChamber } from '../src/physics/devices/climatic-chamber.js'
import { IndicatingInstrument } from '../src/physics/devices/indicating-instrument.js'
import { ComposedInstrument } from '../src/stages/composer.js'
import { VirtualClock } from '../src/time.js'
import { mulberry32, normal } from '../src/physics/rng.js'

const CHAMBER_SPEC = {
  tempRampDegCPerMin: 12,          // fast ramp for short tests (12 °C/min)
  tempStabilityDegC: 0.2,
  tempOvershootDegC: 0.5,
  humidityControl: true,
  humidityRampPercentRhPerMin: 30,
  humidityStabilityPercentRh: 1.5,
}

function chamber(seed = 42) {
  return new ClimaticChamber(CHAMBER_SPEC, mulberry32(seed))
}

describe('ClimaticChamber', () => {
  it('ramps at the rated rate, never teleports', () => {
    const c = chamber()
    c.set(40)
    c.advance(60) // 1 min at 12 °C/min = +12 °C
    const s = c.state()
    expect(s.phase).toBe('ramping')
    expect(s.actualTempDegC).toBeGreaterThan(31.5)
    expect(s.actualTempDegC).toBeLessThan(32.5)
  })

  it('overshoots on arrival, then settles into the stability band', () => {
    const c = chamber()
    c.set(40)
    c.advance(110) // 20 °C at 12 °C/min = 100 s ramp + 10 s soak
    const soaking = c.state()
    expect(['soaking', 'holding']).toContain(soaking.phase)
    // Well past the soak: the hold stays within the stability bound.
    c.advance(3600)
    for (let i = 0; i < 10; i++) {
      c.advance(60)
      expect(Math.abs(c.state().actualTempDegC - 40)).toBeLessThanOrEqual(CHAMBER_SPEC.tempStabilityDegC + 1e-9)
    }
    expect(c.state().phase).toBe('holding')
  })

  it('drives humidity only when humidity-controlled', () => {
    const c = chamber()
    c.set(40, 85)
    c.advance(120)
    expect(c.state().actualHumidityPercentRh).toBeGreaterThan(80)
    const dry = new ClimaticChamber({ ...CHAMBER_SPEC, humidityControl: false }, mulberry32(1))
    dry.set(40, 85)
    dry.advance(120)
    expect(dry.state().actualHumidityPercentRh).toBeNull()
  })

  it('off() drifts back toward the lab ambient', () => {
    const c = chamber()
    c.set(40)
    c.advance(200)
    c.off()
    c.advance(600)
    expect(Math.abs(c.state().actualTempDegC - 20)).toBeLessThan(1)
  })

  it('is deterministic per harness seed', () => {
    const a = chamber(7)
    const b = chamber(7)
    a.set(40)
    b.set(40)
    a.advance(500)
    b.advance(500)
    expect(a.actualTemperatureDegC()).toBe(b.actualTemperatureDegC())
  })
})

describe('IndicatingInstrument', () => {
  it('forms the reading: conversion, calibration state, quantization', () => {
    const ind = new IndicatingInstrument({
      kgPerMVperV: 250,            // a 500 kg / 2 mV/V cell
      gainErrorFraction: 0.0001,
      offsetKg: 0.01,
      scaleIntervalKg: 0.1,
      noiseSigmaKg: 0,
    }, normal(mulberry32(5)))
    // Full bridge output (2 mV/V) → 500 kg nominal, +0.05 gain, +0.01 offset,
    // quantized to 0.1 kg.
    expect(ind.read(2.0)).toBeCloseTo(500.1, 5)
  })

  it('quantizes to its own scale interval', () => {
    const ind = new IndicatingInstrument({
      kgPerMVperV: 250, gainErrorFraction: 0, offsetKg: 0, scaleIntervalKg: 0.5, noiseSigmaKg: 0,
    }, normal(mulberry32(5)))
    expect(ind.read(1.004)).toBeCloseTo(251, 5) // 1.004 × 250 = 251 → 251.0 at 0.5 kg d
  })
})

describe('ComposedInstrument × bench equipment', () => {
  function instrument(stack = 'digital') {
    const clock = new VirtualClock()
    const inst = new ComposedInstrument({
      classification: { construction: 'column', technology: 'strain-gauge', stack },
      coefficients: {
        capacity_kg: 500,
        chamber_temp_ramp_degC_per_min: 30,
        chamber_temp_stability_degC: 0.2,
        chamber_temp_overshoot_degC: 0.4,
        indicator_gain_error_fraction: 0.0002,
      },
    }, clock, 1)
    return { clock, inst }
  }

  it('declares the chamber from the instance coefficients at boot', () => {
    const { inst } = instrument()
    expect(inst.chamberState()).not.toBeNull()
    expect(inst.chamberState()!.engaged).toBe(false)
  })

  it('the chamber drives the environment through its ramp (no teleport)', () => {
    const { clock, inst } = instrument()
    inst.chamberSet(-10)
    clock.advance(10) // 10 s at 30 °C/min = 5 °C
    const gt = inst.groundTruth()
    expect(gt.environment.temperatureDegC).toBeLessThan(19)
    expect(gt.environment.temperatureDegC).toBeGreaterThan(14)
    expect(gt.chamber!.phase).toBe('ramping')
    clock.advance(60) // 30 °C at 0.5 °C/s = 60 s ramp
    expect(inst.groundTruth().chamber!.phase).not.toBe('off')
    clock.advance(700) // the soak decays the overshoot (tau 300 s), then hold
    expect(inst.groundTruth().chamber!.phase).toBe('holding')
    expect(inst.groundTruth().environment.temperatureDegC).toBeGreaterThan(-10.3)
    expect(inst.groundTruth().environment.temperatureDegC).toBeLessThan(-9.5)
  })

  it('setEnvironment disengages the chamber (the direct path wins the channel)', () => {
    const { clock, inst } = instrument()
    inst.chamberSet(-10)
    clock.advance(10)
    inst.setEnvironment({ temperatureDegC: 5 })
    expect(inst.chamberState()!.phase).toBe('off')
    clock.advance(1)
    expect(inst.groundTruth().environment.temperatureDegC).toBe(5)
  })

  it('the bench indicator forms the reading for analogue-passive stacks', () => {
    const { clock, inst } = instrument('analog-passive')
    expect(inst.indicatorState()).not.toBeNull()
    inst.placeMass(500)
    clock.advance(30)
    const reading = inst.indication().value
    // The reading carries the indicator's +0.02 % gain state: 500 × 1.0002 = 500.1
    // (quantized at 0.05 kg, so within a tick of it).
    expect(Math.abs(reading - 500.1)).toBeLessThan(0.1)
    expect(inst.indicatorState()!.readingKg).toBe(reading)
  })

  it('digital stacks keep their own electronics (no bench indicator)', () => {
    const { inst } = instrument('digital')
    expect(inst.indicatorState()).toBeNull()
  })
})
