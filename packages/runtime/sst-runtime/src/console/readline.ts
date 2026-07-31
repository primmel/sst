// console/readline.ts — the node readline console loop (attached by
// `sim-lc500 console`; browser code imports console/client.ts only).
// Handles piped stdin: lines execute SEQUENTIALLY (a piped script
// must behave like typed input), and prompting stops once closed.
import { createInterface, type Interface } from 'node:readline'
import { parseCommand } from './grammar.js'
import { execute, promptOf, type ConsoleIo, type ConsoleState } from './client.js'

export function runConsole(io: ConsoleIo, input: NodeJS.ReadableStream, output: NodeJS.WritableStream): Interface {
  const state: ConsoleState = { privileged: false, watching: false }
  const rl = createInterface({ input, output, prompt: promptOf(state) })
  let closed = false
  let chain: Promise<void> = Promise.resolve()

  io.write('sim-instruments console — type `help` (user exec) then `enable` for privileged mode\n')
  rl.prompt()
  rl.on('line', line => {
    chain = chain.then(async () => {
      const action = parseCommand(line)
      if (action.kind === 'exit') { rl.close(); return }
      try {
        const text = await execute(action, io, state)
        if (text) io.write(text + '\n')
      } catch (e) {
        io.write(`% error: ${e instanceof Error ? e.message : String(e)}\n`)
      }
      // queued commands always run (a piped script must complete);
      // only the prompt stops once readline closed (EOF)
      if (!closed) {
        rl.setPrompt(promptOf(state))
        rl.prompt()
      }
    })
  })
  rl.on('close', () => { closed = true })
  return rl
}
