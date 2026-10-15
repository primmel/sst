// twin-bake.ts — the standalone artifact (spec §9): the serve contract
// baked as JSON at pack time. A zero-SMART boot loads this — primmel-ts
// never imports at runtime.
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { TwinContract } from './twin-contract.js'

export interface BakedContract {
  format: 'sim/baked-twin-contract'
  version: 1
  bakedAt: string
  source: string
  contract: TwinContract
}

export async function bakeTwinContract(contract: TwinContract, outFile: string, source: string): Promise<void> {
  const artifact: BakedContract = {
    format: 'sim/baked-twin-contract', version: 1,
    bakedAt: new Date().toISOString(), source, contract,
  }
  await mkdir(dirname(outFile), { recursive: true })
  await writeFile(outFile, JSON.stringify(artifact, null, 2) + '\n', 'utf-8')
}

export async function loadBakedContract(file: string): Promise<TwinContract> {
  const raw = JSON.parse(await readFile(file, 'utf-8')) as BakedContract
  return loadBakedContractFromArtifact(raw, file)
}

/** The baked-contract loader's pure half: validate + unwrap an
 *  already-parsed artifact (the bundle-native boot carries the baked
 *  JSON as an import, not a file read). */
export function loadBakedContractFromArtifact(raw: BakedContract, source = '(bundled)'): TwinContract {
  if (raw.format !== 'sim/baked-twin-contract' || raw.version !== 1) {
    throw new Error(`not a baked twin contract (or wrong version): ${source}`)
  }
  return raw.contract
}
