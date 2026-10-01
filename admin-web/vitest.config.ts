import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  // Keep vitest from loading a developer's local .env.local (demo mode) into
  // import.meta.env; tests always run with CI's demo-mode-off environment.
  envDir: './src',
  test: {
    environment: 'jsdom',
    // Ant Design DOM suites can stall under concurrent local builds.
    maxWorkers: 2,
    testTimeout: 120_000,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.react.test.{ts,tsx}'],
    coverage: { reporter: ['text', 'json-summary'] },
    // Hermetic tests: a local admin-web/.env.local may turn demo mode on for
    // browser preview; tests must always see CI's demo-mode-off environment.
    env: { VITE_MIP_ADMIN_DEMO_MODE: 'false' },
  },
})
