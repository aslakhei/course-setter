import { defineConfig } from 'vitest/config'

// Tests against the running local Supabase (`pnpm db:start`); run with `pnpm test:integration`.
export default defineConfig({
  test: {
    include: ['supabase/tests/integration/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
})
