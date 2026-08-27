import { defineConfig } from 'vite'

export default defineConfig({
  server: { port: 4174, host: '127.0.0.1' },
  build: { sourcemap: true },
})
