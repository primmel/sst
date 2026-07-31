// session/multi-session.ts — multi-instrument scenarios.
//
// Manages paired sessions that share a VirtualClock + environment.
// The comparison engine reads both instruments' indications at probe
// points and computes the error — the certification-relevant signal.
//
// Use case: run a good-cell and a creep-cell side-by-side under the
// same D 11 profile. The divergence between their indications is the
// creep signature.

import type { VirtualClock } from '../time.js'
import type { Qty } from '../physics/quantity.js'

export interface PairedProbe {
  atS: number
  loadKg: number
  /** Instrument A's indication (the reference). */
  indicationA: number
  /** Instrument B's indication (the device under test). */
  indicationB: number
  /** The difference |B - A| — the error signal. */
  divergenceKg: number
}

export interface ComparisonReport {
  instrumentA: string
  instrumentB: string
  sharedClock: boolean
  probes: PairedProbe[]
  /** The maximum divergence observed. */
  maxDivergenceKg: number
  /** The average divergence. */
  avgDivergenceKg: number
}

/** A pair of instruments sharing a clock + environment. */
export class MultiSession<IA extends { indication(): Qty; groundTruth(): { appliedLoadKg: number }; environment(): unknown; setEnvironment(e: unknown): void }, IB = IA> {
  #clock: VirtualClock
  #instA: IA
  #instB: IB
  #idA: string
  #idB: string

  constructor(idA: string, instA: IA, idB: string, instB: IB, clock: VirtualClock) {
    this.#idA = idA
    this.#instA = instA
    this.#idB = idB
    this.#instB = instB
    this.#clock = clock
  }

  get clock(): VirtualClock { return this.#clock }

  /** Apply an environment change to BOTH instruments simultaneously. */
  setEnvironment(e: Parameters<IA['setEnvironment']>[0]): void {
    this.#instA.setEnvironment(e)
    // Cast: IB has the same shape as IA for setEnvironment.
    ;(this.#instB as unknown as IA).setEnvironment(e)
  }

  /** Place a load on BOTH instruments. */
  placeMass(massKg: number): void {
    // Cast: both instruments have placeMass.
    ;(this.#instA as unknown as { placeMass(kg: number): void }).placeMass(massKg)
    ;(this.#instB as unknown as { placeMass(kg: number): void }).placeMass(massKg)
  }

  /** Tick both instruments by dtS seconds. */
  tick(dtS: number): void {
    ;(this.#instA as unknown as { tick(dtS: number): void }).tick(dtS)
    ;(this.#instB as unknown as { tick(dtS: number): void }).tick(dtS)
  }

  /** Probe both instruments and record the divergence. */
  probe(atS: number): PairedProbe {
    const loadKg = this.#instA.groundTruth().appliedLoadKg
    const indicationA = this.#instA.indication().value
    const indicationB = (this.#instB as unknown as { indication(): Qty }).indication().value
    return {
      atS,
      loadKg,
      indicationA,
      indicationB,
      divergenceKg: Math.abs(indicationB - indicationA),
    }
  }

  /** Compile a comparison report from a series of probes. */
  compare(probes: PairedProbe[]): ComparisonReport {
    const max = probes.reduce((m, p) => Math.max(m, p.divergenceKg), 0)
    const avg = probes.length > 0 ? probes.reduce((s, p) => s + p.divergenceKg, 0) / probes.length : 0
    return {
      instrumentA: this.#idA,
      instrumentB: this.#idB,
      sharedClock: true,
      probes,
      maxDivergenceKg: max,
      avgDivergenceKg: avg,
    }
  }
}
