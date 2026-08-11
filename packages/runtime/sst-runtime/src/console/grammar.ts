// console/grammar.ts — the IOS-like console grammar (spec §7). Pure
// parsing: line → ConsoleAction. The epistemic split is grammatical:
// `show indication` answers from /twin, `show ground-truth` from /world.

export type ConsoleAction =
  | { kind: 'show'; target: 'indication' | 'ground-truth' | 'state' | 'environment' | 'clock' | 'scenarios' | 'profiles' | 'fidelity' | 'lad' | 'chamber' | 'indicator' }
  | { kind: 'enable' }
  | { kind: 'disable' }
  | { kind: 'placeLoad'; massKg: number }
  | { kind: 'removeLoad' }
  | { kind: 'ladApply'; massKg: number; rateKgPerS?: number }
  | { kind: 'ladRelease'; rateKgPerS?: number }
  | { kind: 'chamberSet'; temperatureDegC: number; humidityPercentRh?: number }
  | { kind: 'chamberOff' }
  | { kind: 'setEnvironment'; field: 'temperatureDegC' | 'humidityPercentRh' | 'pressureKPa'; value: number }
  | { kind: 'playProfile'; id: string }
  | { kind: 'advance'; seconds: number }
  | { kind: 'setClockMode'; mode: 'manual' | 'wall' }
  | { kind: 'scenario'; name: string }
  | { kind: 'setFidelity'; servedOffsetKg: number; servedLagS: number }
  | { kind: 'setThermalHysteresis'; perDegC: number; tauS?: number }
  | { kind: 'fidelityReset' }
  | { kind: 'tips' }
  | { kind: 'watch'; target: 'indication' }
  | { kind: 'reset' }
  | { kind: 'tour' }
  | { kind: 'help' }
  | { kind: 'exit' }
  | { kind: 'unknown'; line: string }

const DURATION = /^(\d+(?:\.\d+)?)(s|m|h|d)$/
const DURATION_MULT: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 }

const SHOW_TARGETS = ['indication', 'ground-truth', 'state', 'environment', 'clock', 'scenarios', 'profiles', 'fidelity', 'lad', 'chamber', 'indicator'] as const

export function parseCommand(raw: string): ConsoleAction {
  const line = raw.trim().toLowerCase().replace(/\s+/g, ' ')
  if (line === '') return { kind: 'unknown', line: raw }
  if (line === 'enable') return { kind: 'enable' }
  if (line === 'disable') return { kind: 'disable' }
  if (line === 'exit' || line === 'quit') return { kind: 'exit' }
  if (line === 'help' || line === '?') return { kind: 'help' }
  if (line === 'tips') return { kind: 'tips' }
  if (line === 'tour') return { kind: 'tour' }
  if (line === 'reset') return { kind: 'reset' }
  if (line === 'fidelity reset') return { kind: 'fidelityReset' }

  let m = /^show (\S+)$/.exec(line)
  if (m && (SHOW_TARGETS as readonly string[]).includes(m[1]!)) return { kind: 'show', target: m[1] as (typeof SHOW_TARGETS)[number] }

  m = /^watch (\S+)$/.exec(line)
  if (m && m[1] === 'indication') return { kind: 'watch', target: 'indication' }

  m = /^place load (\d+(?:\.\d+)?)(?:\s*kg)?$/.exec(line)
  if (m) return { kind: 'placeLoad', massKg: Number(m[1]) }
  if (line === 'remove load') return { kind: 'removeLoad' }

  // The load application device (R 60-2, 2.7.2 — the force-generating
  // system): a ramped, machine-error-bearing load, never a free weight.
  m = /^lad apply (\d+(?:\.\d+)?)(?:\s*kg)?(?:\s+at\s+(\d+(?:\.\d+)?)(?:\s*kg\/?s)?)?$/.exec(line)
  if (m) return { kind: 'ladApply', massKg: Number(m[1]), ...(m[2] !== undefined ? { rateKgPerS: Number(m[2]) } : {}) }
  m = /^lad release(?:\s+at\s+(\d+(?:\.\d+)?)(?:\s*kg\/?s)?)?$/.exec(line)
  if (m) return { kind: 'ladRelease', ...(m[1] !== undefined ? { rateKgPerS: Number(m[1]) } : {}) }

  // The climatic chamber (R 60-3, 4.10.3/4.10.4): ramp to the setpoint,
  // never teleport.
  m = /^chamber set (-?\d+(?:\.\d+)?)(?:\s*°?c)?(?:\s+rh\s+(\d+(?:\.\d+)?)(?:\s*%)?)?$/.exec(line)
  if (m) return { kind: 'chamberSet', temperatureDegC: Number(m[1]), ...(m[2] !== undefined ? { humidityPercentRh: Number(m[2]) } : {}) }
  if (line === 'chamber off') return { kind: 'chamberOff' }

  m = /^set temperature (-?\d+(?:\.\d+)?)(?:\s*°?c)?$/.exec(line)
  if (m) return { kind: 'setEnvironment', field: 'temperatureDegC', value: Number(m[1]) }
  m = /^set humidity (\d+(?:\.\d+)?)(?:\s*%|rh)?$/.exec(line)
  if (m) return { kind: 'setEnvironment', field: 'humidityPercentRh', value: Number(m[1]) }
  m = /^set pressure (\d+(?:\.\d+)?)(?:\s*kpa)?$/.exec(line)
  if (m) return { kind: 'setEnvironment', field: 'pressureKPa', value: Number(m[1]) }

  m = /^play profile ([a-z0-9-]+)$/.exec(line)
  if (m) return { kind: 'playProfile', id: m[1]! }

  m = /^advance (\d+(?:\.\d+)?)(s|m|h|d)$/.exec(line)
  if (m) return { kind: 'advance', seconds: Number(m[1]) * (DURATION_MULT[m[2]!] ?? 1) }

  m = /^clock mode (manual|wall)$/.exec(line)
  if (m) return { kind: 'setClockMode', mode: m[1] as 'manual' | 'wall' }

  m = /^scenario ([a-z0-9-]+)$/.exec(line)
  if (m) return { kind: 'scenario', name: m[1]! }

  m = /^set fidelity offset (-?\d+(?:\.\d+)?)(?:\s*kg)?(?:\s+lag (\d+(?:\.\d+)?)(?:\s*s)?)?$/.exec(line)
  if (m) return { kind: 'setFidelity', servedOffsetKg: Number(m[1]), servedLagS: Number(m[2] ?? 0) }

  m = /^set thermal-hysteresis (\d+(?:\.\d+)?(?:e-?\d+)?)(?:\s+tau (\d+(?:\.\d+)?))?$/.exec(line)
  if (m) return { kind: 'setThermalHysteresis', perDegC: Number(m[1]), ...(m[2] !== undefined ? { tauS: Number(m[2]) } : {}) }

  return { kind: 'unknown', line: raw }
}

/** Commands requiring privileged (enable) mode — the console's own
 *  IOS discipline (a teaching device, not a security boundary: every
 *  command reaches /world anyway; the mode teaches the posture). */
export const PRIVILEGED_KINDS: ReadonlySet<ConsoleAction['kind']> = new Set([
  'placeLoad', 'removeLoad', 'ladApply', 'ladRelease', 'chamberSet', 'chamberOff', 'setEnvironment', 'playProfile', 'advance',
  'setClockMode', 'scenario', 'setFidelity', 'setThermalHysteresis', 'fidelityReset', 'reset',
])

export const TIPS_TEXT = `training notes — how to read this bench:
  · nominal vs realized — the machine's setpoint is what the protocol demands;
    the cell feels the REALIZED load (the machine's class error + per-application
    repeatability). 'lad apply 400', then 'show lad' and compare targetKg with
    actualKg. The test report records the nominal; the uncertainty budget owns
    the difference.
  · air vs cell — the chamber ramps (it never teleports), overshoots on arrival,
    and holds with its temporal stability; the CELL soaks after the air per its
    own thermal constants. 'chamber set -10', 'show chamber', and watch the
    indication lag. R 60-2, 2.7.3.6: wait the stabilisation period before any
    reading — a reading taken during the soak is not a measurement.
  · stability limits — R 60-2, 2.7.3.1: during a test the temperature stays
    within one fifth of the cell's rated range, at most 2 °C. The bench
    chamber's ±0.2 °C is well inside; a wobbling chamber would void the run
    (invalid, never a fail).
  · preload discipline — before the test series, apply the maximum test load
    THREE times, returning to the minimum each time, then wait an hour
    (R 60-2): 'lad apply 500' → 'lad release' × 3 → 'advance 1h'.
  · equipment is sized to the instrument — this bench pairs a 500 kg column
    cell with a 600 L climatic chamber and a 10 kN deadweight machine. A
    600 kN canister cell would need a climate room and a comparator machine —
    the R 60 equipment set differs per the instrument's dimensions. Check the
    bench before trusting the protocol.
  · the indicating instrument — an analogue-passive cell has no display: the
    laboratory's indicator forms the reading from the bridge signal, with its
    own calibration state (gain, offset, resolution, noise). 'show indicator'
    on an analogue-passive pairing.
  · the epistemic wall — /twin is what the instrument legally says; /world is
    reality. Certification reads /twin only. A lying twin (set fidelity offset)
    is invisible from /world — the exercise is to catch it from /twin behavior
    alone ('show fidelity' peeks, for the teacher).`

export const HELP_TEXT = `user exec:
  show indication|state|environment|clock   the instrument's legal view (/twin)
  show ground-truth|fidelity|lad|chamber|indicator  reality (/world)
  show scenarios|profiles                   the registries
  enable                                    enter privileged mode
privileged:
  place load <kg> | remove load
  lad apply <kg> [at <kg/s>] | lad release [at <kg/s>]   the force machine (R 60-2, 2.7.2)
  chamber set <°C> [rh <%>] | chamber off          the climatic chamber (R 60-3, 4.10.3/4)
  set temperature <°C> | set humidity <%rh> | set pressure <kPa>
  play profile <id>                         a D 11 chamber program
  advance <n>s|m|h|d                        virtual time
  scenario <name>                           (v2: physics variants are boot-time samples — reboot with the sample appended)
  set fidelity offset <kg> [lag <s>]        twin-infidelity knobs (/world only)
  set thermal-hysteresis <perDegC> [tau <s>] the post-cycle difference knob
  fidelity reset                            the honest twin
  clock mode manual|wall
  tour                                      the guided first run (the two channels, a load, a sweep, the lying twin)
  tips                                      the training notes (how to read the bench)
  watch indication                          stream the indication
  reset                                     power-cycle
  disable | exit`
