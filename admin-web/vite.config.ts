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
            { name: 'router-query', test: /node_modules[\\/]@tanstack[\\/]/, priority: 20 },
            { name: 'charts', test: /node_modules[\\/](recharts|recharts-scale|victory-vendor|d3[^\\/]*|@reduxjs|redux|react-redux|immer)[\\/]/, priority: 15 },
            { name: 'ant-design', test: /node_modules[\\/](antd|@ant-design)[\\/]/, priority: 10 },
            { name: 'vendor', test: /node_modules[\\/]/, priority: 1 },
          ],
        },
      },
    },
  },
})
