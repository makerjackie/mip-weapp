import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    // Ant Design DOM suites are CPU-heavy; bound concurrent jsdom instances.
    maxWorkers: 2,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.react.test.{ts,tsx}'],
    coverage: { reporter: ['text', 'json-summary'] },
  },
})
