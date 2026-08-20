#!/usr/bin/env node

import path from 'node:path'
import process from 'node:process'
import { cloudbaseAuthStatus } from './lib/cloudbase-mcp-runner.mjs'

const root = path.resolve(import.meta.dirname, '..')
const status = cloudbaseAuthStatus(root)
// Authorization is the shared prerequisite. Each operational command binds and
// verifies its exact target environment before making changes.
const ready = status.authStatus === 'READY'

console.log(`[cloudbase-mcp] ${ready ? 'READY' : 'AUTH_REQUIRED'} (canonical mcporter channel)`)
if (ready && status.envStatus !== 'READY') {
  console.log('[cloudbase-mcp] Authorization is ready; the target environment will be bound and verified by each operation.')
}
if (!ready) {
  console.log('[cloudbase-mcp] Run pnpm cloud:auth once; deploy and seed scripts never start authorization automatically.')
  process.exitCode = 1
}
