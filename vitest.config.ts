import { defineConfig } from 'vitest/config'

// One test run for the whole repo; each app/package is a project (apps/web uses its vite.config.ts).
export default defineConfig({
  test: {
    projects: ['apps/*', 'packages/*'],
  },
})
