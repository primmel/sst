// tests/library-bundle-stub.ts — the vitest stand-in for the
// build-injected virtual module (scripts/build.mjs generates the real
// one from SST_LIBRARY_PATH at bundle time; vitest aliases this in).
// The profile names mirror the real library's sample menu so the
// spawner's validation behaves like production.

export const libraryBundle = {
  instanceManifestYaml: [
    'sst_version: "1.0"',
    'tier: primmel-instance',
    'id: stub-cell',
    'title: Stub cell (vitest)',
    'kind: primmel-sst-r60',
  ].join('\n'),
  coefficientsYaml: 'mechanical:\n  compliance_mm_per_kg: 0.001\n',
  sampleYamls: {
    fresh: 'sample_name: fresh\nserial_number: STUB-001\n',
    'creep-fail': 'sample_name: creep-fail\nserial_number: STUB-002\n',
    'creep-fail-001': 'sample_name: creep-fail-001\nserial_number: STUB-001\n',
    'temp-fail': 'sample_name: temp-fail\nserial_number: STUB-003\n',
    'drift-fail': 'sample_name: drift-fail\nserial_number: STUB-004\n',
    'lying-twin': 'sample_name: lying-twin\nserial_number: STUB-005\n',
    'stale-twin': 'sample_name: stale-twin\nserial_number: STUB-006\n',
    'aged-2024': 'sample_name: aged-2024\nserial_number: STUB-007\n',
    'dropped-2023': 'sample_name: dropped-2023\nserial_number: STUB-008\n',
  },
  worldKindSdl: 'extend type Mutation {}\nextend type GroundTruth {}\n',
  worldKindYaml: 'mutations: {}\n',
  handlers: {},
  twinContractJson: {
    format: 'sim/baked-twin-contract',
    version: 1,
    bakedAt: '2026-01-01T00:00:00.000Z',
    source: 'vitest-stub',
    contract: { instrumentId: 'stub-cell', serves: [], operations: [] },
  },
  mpeYaml: undefined,
  physicsChainYaml: undefined,
  behavior: {},
}
