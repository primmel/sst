// autocomplete.ts — Tab-completion data for the console. The grammar
// lives in @primmel/sst-runtime/console/grammar; this module is a pure, framework-
// agnostic tree of completions that mirrors it. Returns [] when nothing
// matches — Console.vue handles the popover + cycling.

export interface Completion { text: string; desc: string }

const TOP_LEVEL: Completion[] = [
  { text: 'show',                 desc: 'read a register (indication, ground-truth, ...)' },
  { text: 'watch indication',     desc: 'stream the served indication' },
  { text: 'place load',           desc: 'place a load on the pan (kg)' },
  { text: 'remove load',          desc: 'clear the pan' },
  { text: 'set temperature',      desc: 'set chamber temperature (°C)' },
  { text: 'set humidity',         desc: 'set relative humidity (%rh)' },
  { text: 'set pressure',         desc: 'set barometric pressure (kPa)' },
  { text: 'set fidelity offset',  desc: 'twin-fidelity offset knob (kg)' },
  { text: 'set thermal-hysteresis', desc: 'post-cycle memory knob' },
  { text: 'play profile',         desc: 'play a D 11 chamber program' },
  { text: 'advance',              desc: 'advance virtual time (e.g. 5m)' },
  { text: 'clock mode',           desc: 'set clock mode (manual | wall)' },
  { text: 'scenario',             desc: 'swap the instrument' },
  { text: 'enable',               desc: 'enter privileged mode' },
  { text: 'disable',              desc: 'leave privileged mode' },
  { text: 'reset',                desc: 'power-cycle' },
  { text: 'fidelity reset',       desc: 'restore the honest twin' },
  { text: 'tour',                 desc: 'the narrated walkthrough' },
  { text: 'help',                 desc: 'list every command' },
  { text: 'exit',                 desc: 'close' },
]

const SHOW_TARGETS: Completion[] = [
  { text: 'indication',   desc: '/twin  — the legal indication' },
  { text: 'ground-truth', desc: '/world — reality' },
  { text: 'state',        desc: '/twin  — operational state' },
  { text: 'environment',  desc: '/world — chamber state' },
  { text: 'clock',        desc: '/world — virtual clock' },
  { text: 'scenarios',    desc: '/world — the registry' },
  { text: 'profiles',     desc: '/world — D 11 profile library' },
  { text: 'fidelity',     desc: '/world — the twin-fidelity knobs' },
]

const SCENARIOS: Completion[] = [
  { text: 'good-cell',   desc: 'all coefficients inside R 60 limits — passes' },
  { text: 'creep-cell',  desc: 'creep beyond MPE — fails the 30-min test' },
  { text: 'temp-cell',   desc: 'temp coefficients excessive — fails temp tests' },
  { text: 'drift-cell',  desc: 'span drift excessive — fails span-stability' },
  { text: 'lying-twin',  desc: 'honest physics; dishonest twin' },
  { text: 'stale-twin',  desc: 'servedAt lags beyond freshness' },
]

const SET_TARGETS: Completion[] = [
  { text: 'temperature',         desc: '°C — chamber temperature' },
  { text: 'humidity',            desc: '%rh — relative humidity' },
  { text: 'pressure',            desc: 'kPa — barometric pressure' },
  { text: 'fidelity offset',     desc: 'kg — the twin-fidelity offset' },
  { text: 'thermal-hysteresis',  desc: 'perDegC [tau <s>] — post-cycle memory' },
]

const MODES: Completion[] = [
  { text: 'manual', desc: 'manual-step clock (default, deterministic)' },
  { text: 'wall',   desc: 'wall-clock mode' },
]

const profileList: Completion[] = [
  { text: 'damp-heat-cyclic-db', desc: 'IEC 60068-2-30 cyclic humidity' },
  { text: 'damp-heat-steady-cab', desc: 'IEC 60068-2-78 steady humidity' },
  { text: 'dry-heat', desc: 'high-temperature steady' },
  { text: 'cold', desc: 'low-temperature steady' },
  { text: 'voltage-dip', desc: 'IEC 61000-4-11 supply dip' },
]

function startsWith(s: string, prefix: string): boolean { return s.startsWith(prefix) || prefix === '' }

/** Compute the completion candidates for the given input. */
export function complete(input: string): Completion[] {
  const text = input.replace(/^\s+/, '')
  if (text === '') return TOP_LEVEL

  const tokens = text.split(/\s+/)
  const head = tokens[0]!
  const tail = text.slice(head.length).replace(/^\s+/, '')

  // Single token: match top-level by prefix on the FIRST word of each entry
  if (tokens.length === 1) {
    return TOP_LEVEL.filter(c => startsWith(c.text.split(' ')[0]!, head))
  }

  // Multi-token dispatch
  if (head === 'show' && tokens.length === 2) {
    return SHOW_TARGETS.filter(c => startsWith(c.text, tail))
  }
  if (head === 'scenario' && tokens.length === 2) {
    return SCENARIOS.filter(c => startsWith(c.text, tail))
  }
  if (head === 'play' && tokens.length === 2) {
    return startsWith('profile', tail) ? [{ text: 'profile', desc: 'then the profile id' }] : []
  }
  if (head === 'play' && tokens[1] === 'profile' && tokens.length === 3) {
    return profileList.filter(c => startsWith(c.text, tail))
  }
  if (head === 'place' && tokens.length === 2) {
    return startsWith('load', tail) ? [{ text: 'load', desc: 'then the mass in kg' }] : []
  }
  if (head === 'remove' && tokens.length === 2) {
    return startsWith('load', tail) ? [{ text: 'load', desc: 'clear the pan' }] : []
  }
  if (head === 'clock' && tokens.length === 2) {
    return startsWith('mode', tail) ? [{ text: 'mode', desc: 'then manual | wall' }] : []
  }
  if (head === 'clock' && tokens[1] === 'mode' && tokens.length === 3) {
    return MODES.filter(c => startsWith(c.text, tail))
  }
  if (head === 'fidelity' && tokens.length === 2) {
    return startsWith('reset', tail) ? [{ text: 'reset', desc: 'restore the honest twin' }] : []
  }
  if (head === 'set' && tokens.length === 2) {
    return SET_TARGETS.filter(c => startsWith(c.text.split(' ')[0]!, tail))
  }
  if (head === 'set' && tokens.length === 3) {
    const t1 = tokens[1]!
    if (t1 === 'fidelity' && startsWith('offset', tail)) return [{ text: 'offset', desc: 'then the kg value' }]
    if (t1 === 'thermal-hysteresis') return [{ text: '', desc: '<perDegC> [tau <s>]' }]
  }
  return []
}

/** When Tab is pressed with a partial, we replace the trailing partial
 *  token with the chosen completion. This helper computes the head to
 *  preserve (everything before the trailing token). */
export function completeApplyPrefix(partial: string): string {
  const trimmed = partial.replace(/\s+$/, '')
  const lastSpace = Math.max(trimmed.lastIndexOf(' '), 0)
  return lastSpace > 0 ? trimmed.slice(0, lastSpace) : ''
}
