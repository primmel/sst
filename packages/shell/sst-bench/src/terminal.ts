// terminal.ts — the console pane: the §7 grammar executed against the
// channels (show indication reads /twin; everything actuating reads
// /world — the console teaches the epistemic split).
import { parseCommand, HELP_TEXT } from '@primmel/sst-runtime/console/grammar'
import { execute, promptOf, type ConsoleIo, type ConsoleState } from '@primmel/sst-runtime/console/client'
import { gql, isUnauthorized, setWorldToken, clearWorldToken } from './api.js'

export function mountTerminal(root: HTMLElement, baseUrl: string): void {
  const log = root.querySelector<HTMLDivElement>('#terminal-log')!
  const form = root.querySelector<HTMLFormElement>('#terminal-form')!
  const prompt = root.querySelector<HTMLSpanElement>('#terminal-prompt')!
  const input = root.querySelector<HTMLInputElement>('#terminal-input')!

  const state: ConsoleState = { privileged: false, watching: false }
  const io: ConsoleIo = {
    write: text => {
      const div = document.createElement('div')
      div.textContent = text.replace(/\n$/, '')
      log.appendChild(div)
      log.scrollTop = log.scrollHeight
    },
    // when the sim guards /world, the first rejected mutation prompts
    // for the token once (sessionStorage); a wrong token is forgotten
    // so the next attempt prompts again. Unguarded sims never prompt.
    query: async (channel, query) => {
      let result = await gql(baseUrl, channel, query)
      if (channel === '/world' && isUnauthorized(result)) {
        const token = window.prompt('this sim guards /world mutations — enter the world token (SIM_WORLD_TOKEN)')
        if (token) {
          setWorldToken(token)
          result = await gql(baseUrl, channel, query)
          if (isUnauthorized(result)) clearWorldToken()
        }
      }
      return result
    },
  }

  io.write('sim-instruments console — `help` for commands, `enable` for privileged mode\n')
  form.addEventListener('submit', e => {
    e.preventDefault()
    const line = input.value
    input.value = ''
    const echo = document.createElement('div')
    echo.className = 'in'
    echo.textContent = `${prompt.textContent} ${line}`
    log.appendChild(echo)
    void (async () => {
      const action = parseCommand(line)
      if (action.kind === 'exit') { io.write('% close the tab to exit — the sim keeps running\n'); return }
      try {
        const text = await execute(action, io, state)
        if (text) io.write(text + '\n')
      } catch (err) {
        const div = document.createElement('div')
        div.className = 'err'
        div.textContent = `% error: ${err instanceof Error ? err.message : String(err)}`
        log.appendChild(div)
      }
      prompt.textContent = promptOf(state)
      log.scrollTop = log.scrollHeight
    })()
  })
  void HELP_TEXT // (surfaced via the help command)
}
