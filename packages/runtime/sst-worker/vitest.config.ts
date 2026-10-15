import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      // The build-injected virtual module — vitest runs the adapter's
      // tests against this stub (scripts/build.mjs generates the real
      // module from SST_LIBRARY_PATH at bundle time).
      'sst-library-bundle': new URL('./tests/library-bundle-stub.ts', import.meta.url).pathname,
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    // Session boots (behavior import + physics + schema generation)
    // are second-scale work — the framework's own boot tests carry
    // 30s timeouts.
    testTimeout: 30_000,
  },
})
