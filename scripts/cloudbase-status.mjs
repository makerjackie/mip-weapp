#!/usr/bin/env node

import path from 'node:path'
import process from 'node:process'
import {
  applyCloudbaseManagementEnv,
  requireCloudbaseManagementEnv,
} from './lib/cloudbase-local-auth.mjs'
import { loginWithCloudbaseManagementApiKey } from './lib/cloudbase-management-auth.mjs'

const root = path.resolve(import.meta.dirname, '..')

try {
  const management = requireCloudbaseManagementEnv(root)
  applyCloudbaseManagementEnv(root)
  const classified = loginWithCloudbaseManagementApiKey(root, management)
  console.log(`[cloudbase-mcp] ${classified.authStatus} (required management API Key)`)
  console.log(`[cloudbase-mcp] env=${classified.envStatus}`)
  console.log('[cloudbase-mcp] management-api-key=configured-and-verified')
}
catch (error) {
  console.error(`[cloudbase-mcp] ERROR; API Key status check failed: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}
