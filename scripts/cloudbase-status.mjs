#!/usr/bin/env node

import path from 'node:path'
import process from 'node:process'
import {
  classifyCloudbaseAuthStatus,
  CLOUD_BASE_AUTH_STATES,
} from './lib/cloudbase-auth-state.mjs'
import {
  applyCloudbaseManagementEnv,
  CLOUDBASE_LOCAL_CREDENTIAL_STATES,
  inspectLocalCloudbaseCredential,
  loadCloudbaseManagementEnv,
} from './lib/cloudbase-local-auth.mjs'
import {
  cloudbaseAuthStatus,
  restartCloudbaseMcp,
} from './lib/cloudbase-mcp-runner.mjs'

const root = path.resolve(import.meta.dirname, '..')
applyCloudbaseManagementEnv(root)
const management = loadCloudbaseManagementEnv(root)
const local = inspectLocalCloudbaseCredential()

let status
try {
  status = cloudbaseAuthStatus(root)
}
catch (error) {
  console.error(`[cloudbase-mcp] ERROR (canonical mcporter channel): ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
  process.exit()
}

let classified = classifyCloudbaseAuthStatus(status)
if (
  classified.authStatus === CLOUD_BASE_AUTH_STATES.REQUIRED
  && management.hasApiKey
) {
  try {
    restartCloudbaseMcp(root)
    status = cloudbaseAuthStatus(root)
    classified = classifyCloudbaseAuthStatus(status)
    console.log('[cloudbase-mcp] Rechecked after daemon restart so a configured management API key could load.')
  }
  catch (error) {
    console.error(`[cloudbase-mcp] ERROR after daemon refresh; no authorization was started: ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
    process.exit()
  }
}

// Authorization is the shared prerequisite. Each operational command binds and
// verifies its exact target environment before making changes.
const ready = classified.authStatus === CLOUD_BASE_AUTH_STATES.READY

console.log(`[cloudbase-mcp] ${classified.authStatus} (canonical mcporter channel)`)
console.log(`[cloudbase-mcp] env=${classified.envStatus}`)
console.log(`[cloudbase-mcp] local=${local.state}`)
if (local.refreshExpiresAt) {
  console.log(`[cloudbase-mcp] local-refresh-until=${local.refreshExpiresAt}`)
}
console.log(`[cloudbase-mcp] management-api-key=${management.hasApiKey ? 'configured' : 'absent'}`)
if (ready && classified.envStatus !== CLOUD_BASE_AUTH_STATES.READY) {
  console.log('[cloudbase-mcp] Authorization is ready; the target environment will be bound and verified by each operation.')
}
if (classified.authStatus === CLOUD_BASE_AUTH_STATES.PENDING) {
  console.log('[cloudbase-mcp] Authorization is already pending; wait for the existing device request instead of starting another one.')
}
if (classified.authStatus === CLOUD_BASE_AUTH_STATES.REQUIRED) {
  if (local.state === CLOUDBASE_LOCAL_CREDENTIAL_STATES.REFRESH_WINDOW_OPEN) {
    console.log('[cloudbase-mcp] Local refresh token is still inside its 30-day window, but CloudBase rejected the refresh. The local file was not deleted.')
  }
  if (management.hasApiKey) {
    console.log('[cloudbase-mcp] A management API key is configured but MCP is still not ready. Check the key; start_auth was not called.')
  }
  else {
    console.log('[cloudbase-mcp] Set CLOUDBASE_API_KEY in .env.local, or run pnpm cloud:auth once. Deploy and seed scripts never start authorization automatically.')
  }
}
if (classified.authStatus === CLOUD_BASE_AUTH_STATES.ERROR) {
  console.log('[cloudbase-mcp] CloudBase returned an unusable auth status; fix the MCP response or local setup before authenticating.')
}
if (!ready) {
  process.exitCode = 1
}
