#!/usr/bin/env node

import path from 'node:path'
import process from 'node:process'
import {
  classifyCloudbaseAuthState,
  CLOUD_BASE_AUTH_STATES,
} from './lib/cloudbase-auth-state.mjs'
import {
  applyCloudbaseManagementEnv,
  loadCloudbaseManagementEnv,
} from './lib/cloudbase-local-auth.mjs'
import {
  callCloudbaseMcp,
  cloudbaseAuthStatus,
  restartCloudbaseMcp,
} from './lib/cloudbase-mcp-runner.mjs'

const root = path.resolve(import.meta.dirname, '..')
applyCloudbaseManagementEnv(root)
const management = loadCloudbaseManagementEnv(root)

function authState(status) {
  return classifyCloudbaseAuthState(status?.authStatus ?? status?.auth_status ?? status)
}

function findAuthorizationField(value, names) {
  if (!value || typeof value !== 'object') {
    return undefined
  }
  for (const name of names) {
    if (typeof value[name] === 'string' && value[name].trim()) {
      return value[name].trim()
    }
  }
  for (const nested of Object.values(value)) {
    const found = findAuthorizationField(nested, names)
    if (found) {
      return found
    }
  }
  return undefined
}

function loginWithManagementApiKey() {
  if (!management.hasApiKey) {
    return false
  }
  if (!management.hasEnvId) {
    console.error('[cloudbase-mcp] ERROR; CLOUDBASE_API_KEY is set but CLOUDBASE_ENV_ID is missing, start_auth was not called.')
    process.exitCode = 1
    process.exit()
  }
  try {
    restartCloudbaseMcp(root)
    const restarted = cloudbaseAuthStatus(root)
    if (authState(restarted) === CLOUD_BASE_AUTH_STATES.READY) {
      console.log('[cloudbase-mcp] READY via management API key; start_auth was not called.')
      process.exit(0)
    }
  }
  catch (error) {
    console.error(`[cloudbase-mcp] ERROR after API key daemon refresh; no authorization was started: ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
    process.exit()
  }
  try {
    callCloudbaseMcp(root, 'auth', {
      action: 'login_by_api_key',
      apiKey: management.apiKey,
      apiKeyEnvId: management.envId,
    }, 30000)
    const loggedIn = cloudbaseAuthStatus(root)
    if (authState(loggedIn) === CLOUD_BASE_AUTH_STATES.READY) {
      console.log('[cloudbase-mcp] READY after management API key login; start_auth was not called.')
      process.exit(0)
    }
  }
  catch (error) {
    console.error(`[cloudbase-mcp] ERROR; management API key login failed, start_auth was not called: ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
    process.exit()
  }
  console.error('[cloudbase-mcp] ERROR; management API key is configured but MCP is still not ready, start_auth was not called.')
  process.exitCode = 1
  process.exit()
}

let status
try {
  status = cloudbaseAuthStatus(root)
}
catch (error) {
  console.error(`[cloudbase-mcp] ERROR; status check failed, no authorization was started: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}

if (!status) {
  process.exit(1)
}

let state = authState(status)
if (state === CLOUD_BASE_AUTH_STATES.READY) {
  console.log('[cloudbase-mcp] READY; existing authorization reused, start_auth was not called.')
  process.exit(0)
}

if (state === CLOUD_BASE_AUTH_STATES.PENDING) {
  console.log('[cloudbase-mcp] PENDING; an existing authorization request is still active, daemon restart and start_auth were not called.')
  process.exitCode = 1
  process.exit()
}

if (state === CLOUD_BASE_AUTH_STATES.ERROR) {
  console.error('[cloudbase-mcp] ERROR; status is unusable, no authorization was started.')
  process.exitCode = 1
  process.exit()
}

if (management.hasApiKey) {
  loginWithManagementApiKey()
}

// Another long-lived MCP process may have refreshed the shared CloudBase
// credential file after this daemon started. Restart this one canonical daemon
// once before creating a new device code.
try {
  restartCloudbaseMcp(root)
  status = cloudbaseAuthStatus(root)
}
catch (error) {
  console.error(`[cloudbase-mcp] ERROR after daemon refresh; no authorization was started: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
  process.exit()
}

state = authState(status)
if (state === CLOUD_BASE_AUTH_STATES.READY) {
  console.log('[cloudbase-mcp] READY after daemon refresh; existing authorization reused, start_auth was not called.')
  process.exit(0)
}

if (state === CLOUD_BASE_AUTH_STATES.PENDING) {
  console.log('[cloudbase-mcp] PENDING after daemon refresh; an existing authorization request is active, start_auth was not called.')
  process.exitCode = 1
  process.exit()
}

if (state === CLOUD_BASE_AUTH_STATES.ERROR) {
  console.error('[cloudbase-mcp] ERROR after daemon refresh; status is unusable, no authorization was started.')
  process.exitCode = 1
  process.exit()
}

const authorization = callCloudbaseMcp(root, 'auth', {
  action: 'start_auth',
  authMode: 'device',
}, 30000)
console.log('[cloudbase-mcp] One device authorization is required. Complete only this latest request:')
const verificationUrl = findAuthorizationField(authorization, [
  'verification_uri_complete',
  'verificationUriComplete',
  'verification_url',
  'verificationUrl',
  'verification_uri',
  'verificationUri',
])
const userCode = findAuthorizationField(authorization, ['user_code', 'userCode'])
const message = findAuthorizationField(authorization, ['message'])
if (verificationUrl) {
  console.log(`[cloudbase-mcp] URL: ${verificationUrl}`)
}
if (userCode) {
  console.log(`[cloudbase-mcp] Code: ${userCode}`)
}
if (!verificationUrl && !userCode && message) {
  console.log(`[cloudbase-mcp] ${message}`)
}
if (!verificationUrl && !userCode && !message) {
  throw new Error('CloudBase returned an authorization request without a usable URL or user code.')
}
