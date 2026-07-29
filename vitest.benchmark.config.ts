import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['benchmark/**/*.bench.ts'],
    testTimeout: 60 * 60 * 1000,
    hookTimeout: 120_000,
    reporters: ['verbose'],
  },
})
