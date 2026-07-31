import { describe, it, expect } from 'vitest'
import { qty, add, mul, subtract, abs } from './quantity.js'

describe('quantity (INV-1: no bare numbers)', () => {
  it('derives kind from unit; arithmetic keeps unit/kind', () => {
    const a = qty(40, 'kg'), b = qty(2.5, 'kg')
    expect(a.kind).toBe('mass')
    expect(add(a, b)).toEqual({ value: 42.5, unit: 'kg', kind: 'mass' })
    expect(subtract(a, b).value).toBeCloseTo(37.5)
    expect(mul(a, 2)).toEqual({ value: 80, unit: 'kg', kind: 'mass' })
    expect(abs(qty(-3, 'degC')).value).toBe(3)
  })
  it('rejects kind-incoherent operations', () => {
    // the guard is runtime: both operands type as Qty (the kind is data)
    expect(() => add(qty(1, 'kg'), qty(20, 'degC'))).toThrow(/kind mismatch/)
  })
})
