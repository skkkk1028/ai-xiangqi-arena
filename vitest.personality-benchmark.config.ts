import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['benchmark/personality-safety.safety.ts'],
    testTimeout: 30 * 60 * 1000,
    hookTimeout: 120_000,
    reporters: ['verbose'],
  },
})
