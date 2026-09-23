import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    // Ant Design DOM suites can stall under concurrent local builds.
    maxWorkers: 2,
    testTimeout: 120_000,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.react.test.{ts,tsx}'],
    coverage: { reporter: ['text', 'json-summary'] },
  },
})
