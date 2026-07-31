// kinds/world-schema-assembler.ts — the generic world-schema assembler.
//
// Reads a kind's data files (world-kind.sdl.graphql, world-kind.yaml,
// handlers.ts) and composes a WorldKind automatically. This is the
// model-driven thesis applied to the /world channel: the kind package
// declares the surface as DATA; the runtime composes it into code.
//
// Eliminates the hand-coded buildXxxWorldSchema functions — each kind's
// world.ts is replaced by this generic assembler + the kind's YAML/SDL/
// handlers.
//
// Usage (from a boot strategy):
//   const kind = await assembleWorldKind(kindDir, scenarios)
//   const worldSchema = buildWorldSchemaFor(ctx, kind)

import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parse as parseYaml } from 'yaml'
import type { GraphQLSchema } from 'graphql'
import { buildWorldSchemaFor, type WorldContext, type WorldKind, type WorldInstrument } from '../world-schema.js'

/** Assemble a WorldKind from a kind package's data files.
 *
 *  Reads:
 *    - world-kind.sdl.graphql → Mutation field declarations + GroundTruth type
 *    - world-kind.yaml        → mutation → handler mapping
 *    - handlers.ts            → handler implementations (dynamic import)
 *
 *  The `scenarios` parameter carries the kind's scenario definitions
 *  (sourced from the family package's scenario registry — the YAML
 *  carries overrides, not full definitions).
 *
 *  The `groundTruth` resolver is uniform across all kinds:
 *  `ctx => ctx.instrument.groundTruth()`. */
export async function assembleWorldKind<I extends WorldInstrument, D>(
  kindDir: string,
  scenarios: WorldKind<I, D>['scenarios'],
): Promise<WorldKind<I, D>> {
  // 1. Read the SDL — extract Mutation fields, GroundTruth type, and
  //    any supporting type definitions (GasBench, TargetState, …).
  const sdlPath = join(kindDir, 'world-kind.sdl.graphql')
  if (!existsSync(sdlPath)) {
    throw new Error(`assembleWorldKind: no world-kind.sdl.graphql in ${kindDir}`)
  }
  const sdl = await readFile(sdlPath, 'utf-8')
  const mutationFields = extractBlock(sdl, 'extend type Mutation')
  const groundTruthFields = extractBlock(sdl, 'extend type GroundTruth')
  const supportingTypes = extractSupportingTypes(sdl)
  const groundTruthType = groundTruthFields
    ? `type GroundTruth { ${groundTruthFields} }`
    : ''
  const types = [supportingTypes, groundTruthType].filter(Boolean).join('\n')

  // 2. Read the YAML — mutation → handler mapping.
  const yamlPath = join(kindDir, 'world-kind.yaml')
  if (!existsSync(yamlPath)) {
    throw new Error(`assembleWorldKind: no world-kind.yaml in ${kindDir}`)
  }
  const yaml = parseYaml(await readFile(yamlPath, 'utf-8')) as {
    mutations: Record<string, { handler: string }>
  }

  // 3. Dynamic-import the handlers.
  const handlersPath = join(kindDir, 'handlers.ts')
  if (!existsSync(handlersPath)) {
    throw new Error(`assembleWorldKind: no handlers.ts in ${kindDir}`)
  }
  const handlersModule = await import(pathToFileURL(handlersPath).href)
  const handlers = handlersModule.handlers as Record<string, (ctx: WorldContext<I, D>, args: Record<string, unknown>) => void>

  // 4. Wire mutations: each YAML entry maps a mutation name to a handler.
  const mutations: Record<string, (ctx: WorldContext<I, D>, args: Record<string, unknown>) => void> = {}
  for (const [mutationName, { handler: handlerName }] of Object.entries(yaml.mutations)) {
    const handler = handlers[handlerName]
    if (!handler) {
      throw new Error(
        `assembleWorldKind: handler '${handlerName}' not found for mutation '${mutationName}' ` +
        `(available: ${Object.keys(handlers).join(', ')})`,
      )
    }
    mutations[mutationName] = handler
  }

  // 5. Compose the WorldKind.
  return {
    types,
    mutationFields,
    scenarios,
    groundTruth: (ctx) => (ctx.instrument as unknown as { groundTruth(): unknown }).groundTruth(),
    mutations,
  } as WorldKind<I, D>
}

/** Build a world schema from a kind directory + context + scenarios.
 *  Convenience wrapper: assembles the WorldKind then calls
 *  buildWorldSchemaFor. */
export async function buildWorldSchemaFromKind<I extends WorldInstrument, D>(
  kindDir: string,
  ctx: WorldContext<I, D>,
  scenarios: WorldKind<I, D>['scenarios'],
): Promise<GraphQLSchema> {
  const kind = await assembleWorldKind<I, D>(kindDir, scenarios)
  return buildWorldSchemaFor(ctx, kind)
}

/** Extract the inner content of a `{ ... }` block following a marker
 *  string in an SDL document. Returns the trimmed field declarations. */
function extractBlock(sdl: string, marker: string): string {
  const idx = sdl.indexOf(marker)
  if (idx < 0) return ''
  const after = sdl.slice(idx + marker.length)
  const start = after.indexOf('{')
  if (start < 0) return ''
  let depth = 0
  for (let i = start; i < after.length; i++) {
    if (after[i] === '{') depth++
    else if (after[i] === '}') {
      depth--
      if (depth === 0) return after.slice(start + 1, i).trim()
    }
  }
  return ''
}

/**
 * Extract standalone `type Foo { ... }` definitions from the SDL
 * (everything that is not an `extend type`). These are the kind's
 * supporting types (GasBench, TargetState, ObjectState, …) that
 * GroundTruth fields reference.
 */
function extractSupportingTypes(sdl: string): string {
  const blocks: string[] = []
  // Match top-level `type Name` that is NOT preceded by `extend `.
  const re = /(?:^|\n)(?!extend\s)type\s+(\w+)\s*\{/g
  let match: RegExpExecArray | null
  while ((match = re.exec(sdl)) !== null) {
    const name = match[1]!
    // Skip WorldState / Environment — owned by the core world schema.
    if (name === 'WorldState' || name === 'Environment' || name === 'GroundTruth') continue
    const startBrace = sdl.indexOf('{', match.index)
    if (startBrace < 0) continue
    let depth = 0
    for (let i = startBrace; i < sdl.length; i++) {
      if (sdl[i] === '{') depth++
      else if (sdl[i] === '}') {
        depth--
        if (depth === 0) {
          // Include from 'type' keyword through closing brace.
          const typeStart = sdl.lastIndexOf('type', startBrace)
          blocks.push(sdl.slice(typeStart, i + 1).trim())
          break
        }
      }
    }
  }
  return blocks.join('\n')
}
