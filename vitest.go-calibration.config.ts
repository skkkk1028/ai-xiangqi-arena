import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['benchmark/go-ai/calibration.bench.ts'],
    testTimeout: 7 * 24 * 60 * 60 * 1000,
    hookTimeout: 15 * 60 * 1000,
    reporters: ['verbose'],
  },
})
