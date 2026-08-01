// console/tour.ts — the guided first run (the design doc §9 promise).
// A scripted, narrated walk through the instrument's two channels:
// what the instrument legally says (/twin) vs reality (/world), a load,
// an environment sweep, and the lying-twin lesson. Family-shaped by the
// injected steps (the lc500 today — the only console-shipping family).

import type { ConsoleIo, ConsoleState } from './client.js'
import { execute } from './client.js'
import { parseCommand } from './grammar.js'

/** One tour step: the narration line, the console command to run, and
 *  a pause after (the instrument's virtual time settles instantly; the
 *  pause is for the human reading the narration). */
interface TourStep {
  /** What the step teaches (printed before the command runs). */
  narrate: string
  /** The console command to execute (the SAME grammar the user types — the tour never bypasses it). */
  command: string
  /** Pause after the step, ms (default 1200). */
  pauseMs?: number
}

/** The load-cell tour (the lc500 console): the two channels, a load,
 *  an environment sweep, and the lying-twin lesson. */
export const LC500_TOUR: TourStep[] = [
  {
    narrate:
      'Welcome to the simulated load cell. Two channels face you: /twin is what the instrument LEGALLY says (what a certification engine reads), /world is REALITY (what the operator sees). First — what the instrument says about itself right now:',
    command: 'show indication',
  },
  {
    narrate:
      'That was /twin. Now reality — the world the instrument lives in (the applied load, the strain, the environment, the clock):',
    command: 'show ground-truth',
  },
  {
    narrate:
      'Nothing on the pan yet. Let us put 40 kg on it — the same command you would type yourself (privileged mode):',
    command: 'place load 40',
  },
  {
    narrate: 'And a few seconds for the physics to settle:',
    command: 'advance 30s',
  },
  {
    narrate: 'Now the instrument says (watch it read the load it just felt):',
    command: 'show indication',
  },
  {
    narrate:
      'The world is not just loads. Let us sweep the temperature — an OIML D 11 condition — to 60 °C and see what the coefficients do:',
    command: 'set temperature 60',
  },
  {
    narrate: 'A dwell for the chamber program to act:',
    command: 'advance 60s',
  },
  {
    narrate: 'The instrument now reads (temperature acts on zero and span — this is what the R 60 temperature tests measure):',
    command: 'show indication',
  },
  {
    narrate:
      'Back to reference conditions. Watch the post-cycle memory — real cells do not return exactly (the configurable thermal hysteresis):',
    command: 'set temperature 20',
  },
  {
    narrate: '',
    command: 'advance 60s',
  },
  {
    narrate: '',
    command: 'show indication',
  },
  {
    narrate:
      'Now the important lesson — the LYING TWIN. We tell the instrument to serve a false reading: a 2 kg offset on the SERVED value only. Reality is untouched — and that is the whole point.',
    command: 'set fidelity offset 2',
  },
  {
    narrate: 'Fifteen virtual minutes pass:',
    command: 'advance 15m',
  },
  {
    narrate: 'Reality first — the world never changed: the load is still exactly what we placed.',
    command: 'show ground-truth',
  },
  {
    narrate:
      'And now the served reading — it DRIFTED, though nothing physical changed. A certification engine reading only /twin would see a faithful-looking value that is WRONG. This is the epistemic wall: a served value is a claim, not a fact. It is also why the paired analogue dial exists — a human reading the needle catches what the API cannot say.',
    command: 'show indication',
  },
  {
    narrate:
      'Restore the honest instrument with fidelity reset. (One more thing: physics VARIANTS — a creeping cell, a drifting one — are boot-time SAMPLES, one boot one chain of custody. Exit and reboot with the sample appended, e.g. `… run …/acme-lc500 5290 creep-fail`, then the same 450 kg dwell creeps past the class allowance.) The bench is yours: help lists the commands (the bench web app shows the physical scene and the dial).',
    command: 'fidelity reset',
  },
]

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

/** Run the tour: narrate each step, then execute its command through
 *  the normal console machinery (never a back door), printing both. */
export async function runTour(io: ConsoleIo, state: ConsoleState, steps: TourStep[] = LC500_TOUR): Promise<string> {
  const out: string[] = []
  const wasPrivileged = state.privileged
  state.privileged = true // the guide may actuate; the user watches
  try {
    for (const step of steps) {
      if (step.narrate) out.push(`\n% — ${step.narrate}`)
      out.push(`% > ${step.command}`)
      const text = await execute(parseCommand(step.command), io, state)
      if (text) out.push(text)
      await sleep(step.pauseMs ?? 1200)
    }
  } finally {
    state.privileged = wasPrivileged
  }
  out.push('\n% — tour complete. Type `help` for the command list, or open the bench web app for the physical scene and the dial.')
  return out.join('\n')
}
