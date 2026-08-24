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
  loginWithCloudbaseManagementApiKey(root, management)
  console.log('[cloudbase-mcp] READY via required environment-level management API Key.')
}
catch (error) {
  console.error(`[cloudbase-mcp] ERROR; API Key login failed: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}
