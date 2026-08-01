// session.ts — boot a running SST session from a loaded instance.
//
// The public entry; delegates to session/boot.ts (single-kind) or
// session/composite.ts (composite, spec §13) based on the manifest.

import type { LoadedPackage } from './package-loader.js'
import { lookupKind } from './kinds/registry.js'
import { bootSession, type BootPaths } from './session/boot.js'
import { composeSession } from './session/composite.js'

export interface SessionOptions {
  port?: number
  sample?: string
  seed?: number
  /** The bench directory to serve at `/` (the shell embeds this). */
  benchDir?: string
  /** Bearer token guarding /world mutations. */
  worldToken?: string
}

export interface Session {
  port: number
  url: string
  instanceId: string
  kindId: string
  close(): Promise<void>
}

/**
 * Boot a running SST session.
 *
 * Dispatches on the manifest:
 *   - if `composition` is present: composite boot (composeSession).
 *   - otherwise: single-kind boot (runSession / bootSession).
 */
export async function runSession(
  instance: LoadedPackage,
  opts: SessionOptions = {},
  paths: BootPaths = {},
): Promise<Session> {
  if (instance.manifest.composition) {
    return composeSession(instance, opts, paths)
  }
  // Pre-flight: ensure the referenced kind is registered, so the error
  // message is helpful before bootSession kicks off filesystem work.
  if (instance.manifest.kind) lookupKind(instance.manifest.kind)
  return bootSession(instance, opts, paths)
}
