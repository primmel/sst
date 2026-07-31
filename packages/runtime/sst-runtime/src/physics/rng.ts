/** mulberry32 — small, fast, seeded (determinism, spec Global Constraints). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
/** Box–Muller over the seeded uniform: unit-normal sample. */
export function normal(rng: () => number): () => number {
  return () => {
    let u = 0, v = 0
    while (u === 0) u = rng()
    v = rng()
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
  }
}
