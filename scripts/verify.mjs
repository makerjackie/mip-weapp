#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import process from 'node:process'

const root = process.cwd()
const steps = [
  ['architecture:check', ['node', 'scripts/architecture-check.mjs']],
  ['security:check', ['node', 'scripts/security-check.mjs']],
  ['mcp:doctor', ['node', 'scripts/mcp-doctor.mjs']],
  ['typecheck', ['pnpm', 'typecheck']],
  ['lint', ['pnpm', 'lint']],
  ['stylelint', ['pnpm', 'stylelint']],
  ['test', ['pnpm', 'test']],
  ['verify:source', ['pnpm', 'verify:source']],
  ['build', ['pnpm', 'build']],
  ['verify:analyze', ['pnpm', 'verify:analyze']],
  ['verify:build', ['pnpm', 'verify:build']],
  ['verify:server', ['pnpm', 'verify:server']],
  ['docs:check', ['pnpm', 'docs:check']],
]

for (const [name, command] of steps) {
  console.log(`\n==> ${name}`)
  const result = spawnSync(command[0], command.slice(1), {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, WEAPP_VITE_MCP: '0' },
  })
  if (result.error) {
    throw result.error
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

console.log('\nverify passed')
