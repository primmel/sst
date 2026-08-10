// lib.ts — the test suite's one handle on the instrument library
// (the split, TODO.integration/24): kinds + instances resolve through
// src/library-paths.ts. The library is DECLARED: the package tests
// require SST_LIBRARY_PATH (CI sets it to the workflow's checkout
// position); the resolution errors honestly when it is unset.
import { resolve } from 'node:path'
import { resolveLibraryPaths } from '../src/library-paths.js'

const LIB = resolveLibraryPaths()

export const LIB_ROOT = resolve(LIB.kindsDir, '..', '..')
export const KINDS_DIR = LIB.kindsDir
export const INSTANCES_DIR = LIB.instancesDir
export const BASE_DIR = resolve(LIB_ROOT, 'packages', 'base')
export const instancePath = (id: string): string => resolve(INSTANCES_DIR, id)
export const kindPath = (id: string): string => resolve(KINDS_DIR, id)
