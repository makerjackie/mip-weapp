import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: { port: 4174, host: '127.0.0.1' },
  build: {
    sourcemap: true,
    rolldownOptions: {
      output: {
        codeSplitting: {
          // Keep framework groups whole: size-based subdivision can break Ant Design's circular initialization order.
          groups: [
            { name: 'react', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/, priority: 30 },
            { name: 'tanstack', test: /node_modules[\\/]@tanstack[\\/]/, priority: 20 },
            { name: 'ant-design', test: /node_modules[\\/](antd|@ant-design)[\\/]/, priority: 10 },
            { name: 'vendor', test: /node_modules[\\/]/, priority: 1 },
          ],
        },
      },
    },
  },
})
