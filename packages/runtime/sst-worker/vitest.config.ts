import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // Session boots (behavior import + physics + schema generation)
    // are second-scale work — the framework's own boot tests carry
    // 30s timeouts.
    testTimeout: 30_000,
  },
})
