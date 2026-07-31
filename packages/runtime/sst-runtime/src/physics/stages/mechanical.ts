// stages/mechanical.ts — the elastic element (spec §4.1 stage 1, §4.5 laws).
import type { ConstructionProfile as Profile } from '../families/construction.js'
export type { ConstructionProfile } from '../families/construction.js'

export class MechanicalStage {
  #profile: Profile
  #elastic = 0      // instantaneous elastic strain (branch-adjusted)
  #creep = 0        // creep state (approaches creepCoefficient × elastic)
  #branch: 'loading' | 'unloading' | 'idle' = 'idle'
  #lastLoad = 0

  constructor(profile: Profile, _rng: () => number) { this.#profile = profile }

  get strainMm(): number {
    const h = this.#branch === 'unloading' ? this.#profile.hysteresisClass : 0
    return this.#elastic * (1 - h) + this.#creep
  }

  /** The applied load as set (ground truth — never the indication). */
  get appliedLoadKg(): number { return this.#lastLoad }

  setLoad(massKg: number): void {
    if (massKg < 0) throw new Error(`load must be ≥ 0, got ${massKg}`)
    this.#branch = massKg > this.#lastLoad ? 'loading' : massKg < this.#lastLoad ? 'unloading' : this.#branch
    this.#lastLoad = massKg
    this.#elastic = massKg * this.#profile.complianceKgPerMm
  }

  advance(dtS: number): void {
    const target = this.#elastic * this.#profile.creepCoefficient
    this.#creep += (target - this.#creep) * (1 - Math.exp(-dtS / this.#profile.creepTauS))
  }

  reset(): void { this.#elastic = 0; this.#creep = 0; this.#lastLoad = 0; this.#branch = 'idle' }
}
