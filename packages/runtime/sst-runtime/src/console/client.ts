// console/client.ts — the console executor + the ConsoleIo interface
// (spec §7). Runtime-agnostic (browser-safe): the readline loop lives
// in console/readline.ts (node-only). show indication reads /twin;
// everything actuating reads /world — the console teaches the split.
//
// The console uses raw GraphQL queries (via ConsoleIo) because it
// DISPLAYS raw JSON. The typed TwinDriver/WorldDriver are for
// PROGRAMMATIC clients (bench, tests, external apps) that want
// compile-time-checked method calls — not for a CLI that formats
// arbitrary response shapes.
import { parseCommand, PRIVILEGED_KINDS, HELP_TEXT, type ConsoleAction } from './grammar.js'
import { runTour } from './tour.js'

export interface ConsoleIo {
  /** POST a GraphQL query to a channel path ('/world' | '/twin'). */
  query(channel: '/world' | '/twin', query: string): Promise<unknown>
  write(text: string): void
  /** Optional: when present, the typed drivers are available for
   *  programmatic consumers. The console itself uses raw queries. */
  baseUrl?: string | undefined
  worldToken?: string | undefined
}

export interface ConsoleState {
  privileged: boolean
  watching: boolean
}

function fmt(data: unknown): string {
  return JSON.stringify(data, null, 2)
}

/** Execute one parsed action against the channels. Returns the text
 *  to print (empty string when nothing to print). */
export async function execute(action: ConsoleAction, io: ConsoleIo, state: ConsoleState): Promise<string> {
  if (action.kind === 'unknown') return `% unknown command '${action.line}' — try 'help'`
  if (PRIVILEGED_KINDS.has(action.kind) && !state.privileged) return `% privileged command — 'enable' first`
  switch (action.kind) {
    case 'tour': return runTour(io, state)
    case 'help': return HELP_TEXT
    case 'enable': state.privileged = true; return ''
    case 'disable': state.privileged = false; return ''
    case 'exit': return ''
    case 'show': {
      if (action.target === 'indication') {
        const raw = fmt(await io.query('/twin', `{ indication { value unit } }`))
        return raw.includes('Cannot query field')
          ? raw + '\n% /twin is a placeholder until the twin schema lands (C3, design §6) — this is what a certification engine would see'
          : raw
      }
      if (action.target === 'ground-truth') return fmt(await io.query('/world', `{ groundTruth { appliedLoadKg strainMm clockS spanDriftFraction environment { temperatureDegC humidityPercentRh pressureKPa } } }`))
      if (action.target === 'environment') return fmt(await io.query('/world', `{ groundTruth { environment { temperatureDegC humidityPercentRh pressureKPa } } }`))
      if (action.target === 'clock') return fmt(await io.query('/world', `{ worldState { clock mode } }`))
      if (action.target === 'scenarios') return fmt(await io.query('/world', `{ scenarios { name description } }`))
      if (action.target === 'profiles') return fmt(await io.query('/world', `{ profiles { id standard } }`))
      if (action.target === 'fidelity') return fmt(await io.query('/world', `{ groundTruth { appliedLoadKg clockS } }`))
      return fmt(await io.query('/world', `{ worldState { clock mode } }`))
    }
    case 'placeLoad': return fmt(await io.query('/world', `mutation { placeLoad(massKg: ${action.massKg}) { groundTruth { appliedLoadKg } } }`))
    case 'removeLoad': return fmt(await io.query('/world', `mutation { removeLoad { groundTruth { appliedLoadKg } } }`))
    case 'setEnvironment': return fmt(await io.query('/world', `mutation { setEnvironment(conditions: { ${action.field}: ${action.value} }) { groundTruth { environment { temperatureDegC humidityPercentRh pressureKPa } } } }`))
    case 'playProfile': return fmt(await io.query('/world', `mutation { playProfile(profile: "${action.id}") { clock } }`))
    case 'advance': return fmt(await io.query('/world', `mutation { advanceTime(seconds: ${action.seconds}) { clock } }`))
    case 'setClockMode': return fmt(await io.query('/world', `mutation { setClockMode(mode: "${action.mode}") { mode } }`))
    case 'scenario': return fmt(await io.query('/world', `mutation { scenario(name: "${action.name}") { clock } }`))
    case 'setFidelity': return fmt(await io.query('/world', `mutation { setFidelity(servedOffsetKg: ${action.servedOffsetKg}, servedLagS: ${action.servedLagS}) { clock } }`))
    case 'setThermalHysteresis': return fmt(await io.query('/world', `mutation { setThermalHysteresis(perDegC: ${action.perDegC}${action.tauS !== undefined ? `, tauS: ${action.tauS}` : ''}) { clock } }`))
    case 'fidelityReset': return fmt(await io.query('/world', `mutation { setFidelity(servedOffsetKg: 0, servedLagS: 0) { clock } }`))
    case 'reset': return fmt(await io.query('/world', `mutation { reset { clock } }`))
    case 'watch': {
      state.watching = true
      return '% watching indication (Ctrl-C to stop)'
    }
  }
}

export function promptOf(state: ConsoleState): string {
  return state.privileged ? 'sim#' : 'sim>'
}

/** HTTP ConsoleIo factory: POST GraphQL to `${baseUrl}${channel}`.
 *  The optional token rides /world requests as `Authorization: Bearer
 *  <token>`; unset → no header, the zero-config path. */
export function httpConsoleIo(baseUrl: string, write: (t: string) => void, worldToken?: string): ConsoleIo {
  return {
    write,
    baseUrl,
    worldToken,
    async query(channel, query) {
      const headers: Record<string, string> = { 'content-type': 'application/json' }
      if (worldToken && channel === '/world') headers['authorization'] = `Bearer ${worldToken}`
      const res = await fetch(`${baseUrl}${channel}`, {
        method: 'POST', headers, body: JSON.stringify({ query }),
      })
      return res.json()
    },
  }
}
