// certification/test-program.ts — the R 60-2 test-program executor.
//
// Drives the instrument through a specific test sequence (loads ×
// temperatures × times) and feeds the probes to the certification engine.
// The test program is data — a YAML that encodes the R 60-2 sequence:
//
//   - step: place load 40 kg at 20 °C, hold 5 min, probe
//   - step: advance 30 min, probe (creep)
//   - step: sweep temperature to 40 °C, hold 2h, probe
//   - step: remove load, probe (zero return)
//   - step: sweep back to 20 °C, probe (hysteresis)

import type { ComposedInstrument } from '../stages/composer.js'
import type { VirtualClock } from '../time.js'
import type { CertificationEngine, ProbeResult } from './verdict.js'

export interface TestStep {
  /** Human description of the step. */
  description: string
  /** The load to apply (kg), or null to not change. */
  loadKg?: number
  /** The temperature to set (°C), or null to not change. */
  temperatureDegC?: number
  /** Advance the virtual clock by this many seconds. */
  advanceS?: number
  /** Whether to take a certification probe after this step. */
  probe?: boolean
}

export interface TestProgram {
  name: string
  steps: TestStep[]
}

/** Execute a test program against a composed instrument. Returns the
 *  collected probe results — the raw certification evidence. */
export function executeTestProgram(
  program: TestProgram,
  instrument: ComposedInstrument,
  clock: VirtualClock,
  certEngine: CertificationEngine,
  tickDtS = 0.1,
): ProbeResult[] {
  const probes: ProbeResult[] = []

  for (const step of program.steps) {
    if (step.loadKg != null) instrument.placeMass(step.loadKg)
    if (step.temperatureDegC != null) instrument.setEnvironment({ temperatureDegC: step.temperatureDegC })

    if (step.advanceS != null && step.advanceS > 0) {
      clock.advance(step.advanceS)
      // Run physics ticks to settle the instrument
      const ticks = Math.ceil(step.advanceS / tickDtS)
      for (let i = 0; i < ticks; i++) {
        instrument.tick(tickDtS)
      }
    }

    if (step.probe) {
      const probe = certEngine.probe(
        clock.now(),
        instrument.groundTruth().appliedLoadKg,
        instrument.indication().value,
      )
      probes.push(probe)
    }
  }

  return probes
}

/** The canonical R 60-2 creep test program (30-minute test).
 *  Per R 60-2 §2.10.5: apply E_max, hold 5 min, then probe every
 *  5 min for 30 min. The creep limit is 0.7 × |MPE| over 30 min. */
export const R60_CREEP_TEST: TestProgram = {
  name: 'R 60-2 §2.10.5 creep test (30 min)',
  steps: [
    { description: 'Apply load (E_max)', loadKg: 500, advanceS: 300, probe: true },
    { description: 'Hold 5 min', advanceS: 300, probe: true },
    { description: 'Hold 5 min', advanceS: 300, probe: true },
    { description: 'Hold 5 min', advanceS: 300, probe: true },
    { description: 'Hold 5 min', advanceS: 300, probe: true },
    { description: 'Hold 5 min', advanceS: 300, probe: true },
    { description: 'Hold 5 min', advanceS: 300, probe: true },
  ],
}

/** The canonical R 60-2 repeatability test. */
export const R60_REPEATABILITY_TEST: TestProgram = {
  name: 'R 60-2 repeatability test',
  steps: [
    { description: 'Load 1', loadKg: 100, advanceS: 60, probe: true },
    { description: 'Load 2', loadKg: 100, advanceS: 60, probe: true },
    { description: 'Load 3', loadKg: 100, advanceS: 60, probe: true },
    { description: 'Load 1 at 200', loadKg: 200, advanceS: 60, probe: true },
    { description: 'Load 2 at 200', loadKg: 200, advanceS: 60, probe: true },
    { description: 'Load 3 at 200', loadKg: 200, advanceS: 60, probe: true },
  ],
}

/** A temperature-effect test (R 60-2 §2.10.6). */
export const R60_TEMPERATURE_TEST: TestProgram = {
  name: 'R 60-2 temperature effect test',
  steps: [
    { description: 'Baseline at 20 °C', loadKg: 200, temperatureDegC: 20, advanceS: 120, probe: true },
    { description: 'Sweep to -10 °C', temperatureDegC: -10, advanceS: 600, probe: true },
    { description: 'Sweep to 40 °C', temperatureDegC: 40, advanceS: 600, probe: true },
    { description: 'Return to 20 °C', temperatureDegC: 20, advanceS: 600, probe: true },
  ],
}
