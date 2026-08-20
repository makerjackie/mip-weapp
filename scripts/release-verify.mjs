#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import process from 'node:process'

const root = process.cwd()
const steps = [
  ['verify', ['pnpm', 'verify']],
  ['cloud:doctor', ['pnpm', 'cloud:doctor']],
]

for (const [name, command] of steps) {
  console.log(`\n==> ${name}`)
  const result = spawnSync(command[0], command.slice(1), {
    cwd: root,
    stdio: 'inherit',
    env: process.env,
  })
  if (name === 'cloud:doctor' && result.status !== 0) {
    console.warn('[release:verify] CloudBase is not READY. Static gates passed; cloud deploy still needs owner auth.')
    continue
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

console.log('\nrelease:verify static gates passed. Real-device payment and production cloud remain owner-gated.')
