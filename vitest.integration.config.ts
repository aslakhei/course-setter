import { defineConfig } from 'vitest/config'

// Tests against the running local Supabase (`pnpm db:start`); run with `pnpm test:integration`.
export default defineConfig({
  test: {
    include: ['supabase/tests/integration/**/*.test.ts'],
    testTimeout: 30_000,
    // The files share the database's worker settings (Vault secrets), so they run one after another.
    fileParallelism: false,
    hookTimeout: 60_000,
  },
})
