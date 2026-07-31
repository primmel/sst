import { describe, it, expect } from 'vitest'
import { pointerPositionKg, readingUncertaintyKg, type DialSpec } from './dial.js'
import { LC500_PAIRED_DIAL } from '../../instrument.js'

const spec: DialSpec = { capacityKg: 500, graduationKg: 5, unit: 'kg' }

describe('the analogue-passive dial model (spec §14, smart TODO.v2/09)', () => {
  it('the pointer rests at the nearest graduation (sub-graduation inputs)', () => {
    expect(pointerPositionKg(spec, 0)).toBe(0)
    expect(pointerPositionKg(spec, 2.49)).toBeCloseTo(0, 12)
    expect(pointerPositionKg(spec, 2.5)).toBeCloseTo(5, 12) // half a division rounds up
    expect(pointerPositionKg(spec, 7.6)).toBeCloseTo(10, 12)
    expect(pointerPositionKg(spec, 40)).toBeCloseTo(40, 12)
    expect(pointerPositionKg(spec, 41.27)).toBeCloseTo(40, 12)
  })

  it('coherence: |pointer − ground truth| ≤ graduation/2 across the range', () => {
    const half = spec.graduationKg / 2
    for (let truth = 0; truth <= spec.capacityKg; truth += 0.1) {
      expect(Math.abs(pointerPositionKg(spec, truth) - truth)).toBeLessThanOrEqual(half + 1e-9)
    }
  })

  it('range edges: full scale rests at capacity; out-of-range clamps, never wraps', () => {
    expect(pointerPositionKg(spec, 500)).toBe(500)
    expect(pointerPositionKg(spec, 499.9)).toBeCloseTo(500, 12)
    expect(pointerPositionKg(spec, 510)).toBe(500) // over-range pins at full scale
    expect(pointerPositionKg(spec, -3)).toBe(0) // below zero pins at zero
  })

  it('the declared reading uncertainty is ±½ graduation (rectangular)', () => {
    expect(readingUncertaintyKg(spec)).toBe(2.5)
    expect(readingUncertaintyKg(LC500_PAIRED_DIAL)).toBe(2.5)
  })

  it('deterministic: no RNG in the path — the same truth rests at the same graduation', () => {
    expect(pointerPositionKg(spec, 41.27)).toBe(pointerPositionKg(spec, 41.27))
  })

  it('the declared LC-500 pairing: the dial spans E_max at 5 kg graduations', () => {
    expect(LC500_PAIRED_DIAL).toEqual({ capacityKg: 500, graduationKg: 5, unit: 'kg' })
    expect(LC500_PAIRED_DIAL.capacityKg % LC500_PAIRED_DIAL.graduationKg).toBe(0)
  })
})
