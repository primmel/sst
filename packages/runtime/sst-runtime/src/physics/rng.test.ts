import { describe, it, expect } from 'vitest'
import { mulberry32, normal } from './rng.js'

describe('rng (deterministic, spec Global Constraints)', () => {
  it('same seed → identical sequence (golden)', () => {
    const r = mulberry32(42)
    const seq = Array.from({ length: 5 }, () => r())
    expect(seq).toEqual([
      0.6011037519201636, 0.44829055899754167, 0.8524657934904099,
      0.6697340414393693, 0.17481389874592423,
    ])
  })
  it('different seeds → different sequences', () => {
    const a = mulberry32(1)(), b = mulberry32(2)()
    expect(a).not.toBe(b)
  })
  it('normal() is approximately zero-mean over 10k samples', () => {
    const n = normal(mulberry32(7))
    let sum = 0
    for (let i = 0; i < 10000; i++) sum += n()
    expect(Math.abs(sum / 10000)).toBeLessThan(0.05)
  })
})
