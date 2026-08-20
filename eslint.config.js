import { icebreaker } from '@icebreakers/eslint-config'

export default icebreaker({
  miniProgram: true,
  tailwindcss: {
    entryPoint: './src/app.css',
  },
  ignores: [
    '.generated/**',
    '.tmp/**',
    '.weapp-vite/**',
    'cloudfunctions/**',
    'dist/**',
    'docs/**',
  ],
})
