export type ClockMode = 'manual' | 'wall'

/** The deterministic virtual clock (spec §4.4): manual-step default;
 *  wall-clock opt-in. Time is seconds (float). */
export class VirtualClock {
  #mode: ClockMode = 'manual'
  #virtual = 0
  #wallAnchor = 0 // Date.now()/1000 at the last wall↔manual flip
  #subs: Array<(dt: number) => void> = []

  now(): number {
    return this.#mode === 'wall' ? this.#virtual + (Date.now() / 1000 - this.#wallAnchor) : this.#virtual
  }
  mode(): ClockMode { return this.#mode }
  setMode(m: ClockMode): void {
    if (m === this.#mode) return
    // entering wall mode rebases virtual to the epoch (servedAt
    // timestamps must compare against clients' wall clocks); leaving
    // it freezes the epoch into the virtual timeline.
    this.#virtual = Date.now() / 1000
    this.#wallAnchor = Date.now() / 1000
    this.#mode = m
  }
  advance(seconds: number): void {
    if (!(seconds > 0)) throw new Error(`advance requires seconds > 0, got ${seconds}`)
    this.#virtual = this.now() + seconds
    this.#wallAnchor = Date.now() / 1000
    for (const cb of [...this.#subs]) cb(seconds)
  }
  onAdvance(cb: (dt: number) => void): () => void {
    this.#subs.push(cb)
    return () => { this.#subs = this.#subs.filter(f => f !== cb) }
  }
}
