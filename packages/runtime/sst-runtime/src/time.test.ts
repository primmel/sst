import { describe, it, expect } from 'vitest'
import { VirtualClock } from './time.js'

describe('VirtualClock', () => {
  it('starts at 0 in manual mode and advances deterministically', () => {
    const c = new VirtualClock()
    expect(c.mode()).toBe('manual')
    expect(c.now()).toBe(0)
    c.advance(300)
    expect(c.now()).toBe(300)
  })
  it('notifies subscribers with dt, oldest first; unsubscribe works', () => {
    const c = new VirtualClock()
    const seen: number[] = []
    const off = c.onAdvance(dt => { seen.push(dt) })
    c.advance(60); c.advance(30)
    off(); c.advance(10)
    expect(seen).toEqual([60, 30])
  })
  it('wall mode tracks the wall clock (approximately)', () => {
    const c = new VirtualClock()
    c.setMode('wall')
    const t0 = c.now()
    expect(Math.abs(t0 - Date.now() / 1000)).toBeLessThan(2)
    c.setMode('manual')
    c.advance(5)
    // advance adds exactly 5 to wherever the flip left the clock
    // (the flip rebases to the flip-time epoch, a few ms after t0)
    expect(c.now()).toBeGreaterThanOrEqual(t0 + 5)
    expect(c.now()).toBeLessThan(t0 + 6)
  })
})
