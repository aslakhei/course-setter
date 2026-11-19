import { defineConfig, devices } from '@playwright/test'
import { localSupabase } from '../../supabase/tests/integration/local-supabase.ts'

// End-to-end tests: the production build of the web app against the running local Supabase
// (`pnpm db:start`). Run with `pnpm test:e2e`.
const supabase = localSupabase()
const port = 4173

export default defineConfig({
  testDir: 'e2e',
  globalSetup: './e2e/global-setup.ts',
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `pnpm build && pnpm preview --host 127.0.0.1 --port ${port} --strictPort`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    // Variables set here take precedence over apps/web/.env.local.
    env: { VITE_SUPABASE_URL: supabase.url, VITE_SUPABASE_PUBLISHABLE_KEY: supabase.publishableKey },
  },
})
