// console/generic-grammar.ts — the kind-generic console grammar.
//
// Derives console commands from the kind's world-kind.yaml. Each
// declared mutation becomes a command template:
//
//   placeLoad(massKg: Float!)         → "place load <kg>"
//   setTarget(speedKmh: Float!)       → "set target <kmh>"
//   feedObject(lengthCm: Float, ...)  → "feed object <l> <w> <h>"
//
// The grammar is fully data-driven; no kind-specific code needed.

import type { TwinContract } from '../twin-contract.js'

export interface GenericCommand {
  /** The mutation name (camelCase, as declared in the SDL). */
  mutation: string
  /** The human-readable command template, e.g. "place load <kg>". */
  template: string
  /** The argument names extracted from the SDL signature. */
  args: Array<{ name: string; type: string; required: boolean }>
  /** A human description. */
  description: string
}

/** Parse a GraphQL mutation SDL signature into structured args. */
function parseMutationArgs(sdl: string): Array<{ name: string; type: string; required: boolean }> {
  // SDL forms: "(massKg: Float!)" or "(speedKmh: Float!, rangeM: Float)"
  const inner = sdl.replace(/^\(|\)$/g, '').trim()
  if (!inner) return []
  return inner.split(',').map(part => {
    const m = part.trim().match(/^(\w+):\s*(\w+)(!?)/)
    if (!m) return { name: part.trim(), type: 'Float', required: false }
    return { name: m[1]!, type: m[2]!, required: m[3] === '!' }
  })
}

/** Convert a mutation name + args into a human-readable command template. */
function makeTemplate(mutation: string, args: Array<{ name: string; type: string; required: boolean }>): string {
  // Heuristic: camelCase → words, drop the leading verb's object if it's an arg.
  // "placeLoad" → "place load"
  // "setTarget" → "set target"
  // "feedObject" → "feed object"
  const words = mutation.replace(/([A-Z])/g, ' $1').toLowerCase().trim()

  // Append arg placeholders for scalar types
  const placeholders = args
    .filter(a => a.type === 'Float' || a.type === 'Int' || a.type === 'String')
    .map(a => `<${a.name.replace(/[A-Z]/g, m => m.toLowerCase())}>`)
    .join(' ')

  return placeholders ? `${words} ${placeholders}` : words
}

/** Generate a set of generic console commands from the kind's world-kind.yaml. */
export function generateGrammar(worldKindYaml: {
  mutations: Record<string, { sdl: string; handler: string }>
}): GenericCommand[] {
  const commands: GenericCommand[] = []
  for (const [mutation, spec] of Object.entries(worldKindYaml.mutations)) {
    // Extract the arg list from the SDL signature
    const argMatch = spec.sdl.match(/\(([^)]*)\)/)
    const args = argMatch ? parseMutationArgs(argMatch[1]!) : []
    commands.push({
      mutation,
      template: makeTemplate(mutation, args),
      args,
      description: `Mutation ${mutation} → handler ${spec.handler}`,
    })
  }
  return commands
}

/** The help text derived from the grammar. */
export function grammarHelp(commands: GenericCommand[]): string {
  return commands.map(c => `  ${c.template.padEnd(40)} ${c.description}`).join('\n')
}
