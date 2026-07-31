// session.ts — boot a running SST session from a loaded instance.
//
// The public entry; delegates to session/boot.ts (TODO 24) which
// actually composes the base + kind + instance into a running server.

import type { LoadedPackage } from './package-loader.js'
import { lookupKind } from './kinds/registry.js'
import { bootSession, type BootPaths } from './session/boot.js'

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
 * Boot a running SST session for an instance package.
 *
 * Resolves the instance's referenced kind, loads its physics-chain.yaml,
 * composes a ComposedInstrument with the data-driven composer, builds the
 * /world and /twin schemas, and boots createSimServer. Returns the
 * session handle (URL + close()).
 *
 * Currently wired for `primmel-sst-r60` (load cells). Sibling kinds
 * (R 91 / R 129 / R 144) need their own world-kind + twin-contract
 * registrations — see session/boot.ts.
 */
export async function runSession(
  instance: LoadedPackage,
  opts: SessionOptions = {},
  paths: BootPaths = {},
): Promise<Session> {
  // Pre-flight: ensure the referenced kind is registered, so the error
  // message is helpful before bootSession kicks off filesystem work.
  if (instance.manifest.kind) lookupKind(instance.manifest.kind)

  return bootSession(instance, opts, paths)
}
