#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const root = path.resolve(import.meta.dirname, '..')
const envExample = path.join(root, '.env.example')
const envLocal = path.join(root, '.env.local')

if (!fs.existsSync(envLocal) && fs.existsSync(envExample)) {
  fs.copyFileSync(envExample, envLocal)
  console.log('[setup] created .env.local from .env.example')
}

const setupLocal = spawnSync(process.execPath, [path.join(root, 'scripts/setup-local.mjs'), '--optional'], {
  cwd: root,
  stdio: 'inherit',
})
if (setupLocal.status !== 0) {
  process.exit(setupLocal.status ?? 1)
}

console.log('[setup] local files are ready. Next: pnpm dev:open')
