// node-module-shim.js — the worker bundle's createRequire: identical to
// node:module's, except `require('process')` answers the workerd global
// (workerd's module registry carries node:buffer etc. but not
// node:process, while the process GLOBAL exists — the defensive
// requires inside bundled instance packages need the global).
import { createRequire as nativeCreateRequire } from 'node:module'

export function createRequire(base) {
  const native = nativeCreateRequire(base)
  const shim = (id) => (id === 'process' || id === 'node:process' ? globalThis.process : native(id))
  shim.resolve = (...args) => native.resolve(...args)
  return shim
}

export default createRequire
