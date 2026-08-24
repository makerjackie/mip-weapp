#!/usr/bin/env node

import path from 'node:path'
import process from 'node:process'

const args = process.argv.slice(2)
if (args.length !== 1 || args[0] !== '--allow-device-auth') {
  console.error('[cloudbase-mcp] Device authorization is maintainer-only. Re-run with exactly --allow-device-auth to continue.')
  process.exit(1)
}

// The emergency path must not inherit the project API Key or reload it from
// .env.local when the canonical daemon is restarted.
process.env.CLOUDBASE_AUTH_MODE = 'local'
delete process.env.CLOUDBASE_API_KEY

const {
  classifyCloudbaseAuthState,
  CLOUD_BASE_AUTH_STATES,
} = await import('./lib/cloudbase-auth-state.mjs')
const {
  callCloudbaseMcp,
  cloudbaseAuthStatus,
  restartCloudbaseMcp,
} = await import('./lib/cloudbase-mcp-runner.mjs')

const root = path.resolve(import.meta.dirname, '..')

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

try {
  restartCloudbaseMcp(root)
  const status = cloudbaseAuthStatus(root)
  const state = authState(status)
  if (state === CLOUD_BASE_AUTH_STATES.READY) {
    console.log('[cloudbase-mcp] READY; an existing local authorization is already usable.')
    process.exit(0)
  }
  if (state === CLOUD_BASE_AUTH_STATES.PENDING) {
    throw new Error('A device authorization request is already pending.')
  }
  if (state === CLOUD_BASE_AUTH_STATES.ERROR) {
    throw new Error('CloudBase returned an unusable authorization status.')
  }

  const authorization = callCloudbaseMcp(root, 'auth', {
    action: 'start_auth',
    authMode: 'device',
  }, 30000)
  console.log('[cloudbase-mcp] Complete this maintainer-only device authorization request:')
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
}
catch (error) {
  console.error(`[cloudbase-mcp] ERROR; device authorization failed: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}
