#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'
import process from 'node:process'

const require = createRequire(import.meta.url)
const weappVite = require.resolve('weapp-vite/package.json')
const bin = path.join(path.dirname(weappVite), 'bin', 'weapp-vite.js')
const workspaceRoot = path.resolve(import.meta.dirname, '..', '..')

const child = spawn(process.execPath, [bin, 'mcp', '--workspace-root', workspaceRoot, ...process.argv.slice(2)], {
  cwd: workspaceRoot,
  stdio: 'inherit',
  env: process.env,
})

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
    return
  }
  process.exit(code ?? 1)
})
