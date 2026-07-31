// console/grammar.ts — the IOS-like console grammar (spec §7). Pure
// parsing: line → ConsoleAction. The epistemic split is grammatical:
// `show indication` answers from /twin, `show ground-truth` from /world.

export type ConsoleAction =
  | { kind: 'show'; target: 'indication' | 'ground-truth' | 'state' | 'environment' | 'clock' | 'scenarios' | 'profiles' | 'fidelity' }
  | { kind: 'enable' }
  | { kind: 'disable' }
  | { kind: 'placeLoad'; massKg: number }
  | { kind: 'removeLoad' }
  | { kind: 'setEnvironment'; field: 'temperatureDegC' | 'humidityPercentRh' | 'pressureKPa'; value: number }
  | { kind: 'playProfile'; id: string }
  | { kind: 'advance'; seconds: number }
  | { kind: 'setClockMode'; mode: 'manual' | 'wall' }
  | { kind: 'scenario'; name: string }
  | { kind: 'setFidelity'; servedOffsetKg: number; servedLagS: number }
  | { kind: 'setThermalHysteresis'; perDegC: number; tauS?: number }
  | { kind: 'fidelityReset' }
  | { kind: 'watch'; target: 'indication' }
  | { kind: 'reset' }
  | { kind: 'tour' }
  | { kind: 'help' }
  | { kind: 'exit' }
  | { kind: 'unknown'; line: string }

const DURATION = /^(\d+(?:\.\d+)?)(s|m|h|d)$/
const DURATION_MULT: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 }

const SHOW_TARGETS = ['indication', 'ground-truth', 'state', 'environment', 'clock', 'scenarios', 'profiles', 'fidelity'] as const

export function parseCommand(raw: string): ConsoleAction {
  const line = raw.trim().toLowerCase().replace(/\s+/g, ' ')
  if (line === '') return { kind: 'unknown', line: raw }
  if (line === 'enable') return { kind: 'enable' }
  if (line === 'disable') return { kind: 'disable' }
  if (line === 'exit' || line === 'quit') return { kind: 'exit' }
  if (line === 'help' || line === '?') return { kind: 'help' }
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
  'placeLoad', 'removeLoad', 'setEnvironment', 'playProfile', 'advance',
  'setClockMode', 'scenario', 'setFidelity', 'setThermalHysteresis', 'fidelityReset', 'reset',
])

export const HELP_TEXT = `user exec:
  show indication|state|environment|clock   the instrument's legal view (/twin)
  show ground-truth|fidelity                reality (/world)
  show scenarios|profiles                   the registries
  enable                                    enter privileged mode
privileged:
  place load <kg> | remove load
  set temperature <°C> | set humidity <%rh> | set pressure <kPa>
  play profile <id>                         a D 11 chamber program
  advance <n>s|m|h|d                        virtual time
  scenario <name>                           swap the instrument
  set fidelity offset <kg> [lag <s>]        twin-infidelity knobs (/world only)
  set thermal-hysteresis <perDegC> [tau <s>] the post-cycle difference knob
  fidelity reset                            the honest twin
  clock mode manual|wall
  tour                                      the guided first run (the two channels, a load, a sweep, the lying twin)
  watch indication                          stream the indication
  reset                                     power-cycle
  disable | exit`
