import { defineConfig } from 'vitest/config'

// 18 openings × 2 controls × 2 color-swapped legs can reach roughly 48 hours
// at the product clock. Checkpoints are written after every pair; callers may
// use a shorter explicit timeout for smoke/screening runs.
const testTimeout = Number(process.env.PERSONALITY_SELFPLAY_TEST_TIMEOUT_MS ?? 52 * 60 * 60 * 1000)

export default defineConfig({
  test: {
    environment: 'node',
    include: ['benchmark/personality-selfplay.bench.ts'],
    testTimeout,
    hookTimeout: 120_000,
    reporters: ['verbose'],
  },
})
