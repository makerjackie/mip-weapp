#!/usr/bin/env node

import path from 'node:path'
import process from 'node:process'
import {
  callCloudbaseMcp,
  cloudbaseAuthStatus,
  restartCloudbaseMcp,
} from './lib/cloudbase-mcp-runner.mjs'

const root = path.resolve(import.meta.dirname, '..')

function ready(status) {
  return status.authStatus === 'READY'
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

let status = cloudbaseAuthStatus(root)
if (ready(status)) {
  console.log('[cloudbase-mcp] READY; existing authorization reused, start_auth was not called.')
  process.exit(0)
}

// Another long-lived MCP process may have refreshed the shared CloudBase
// credential file after this daemon started. Restart this one canonical daemon
// once before creating a new device code.
restartCloudbaseMcp(root)
status = cloudbaseAuthStatus(root)
if (ready(status)) {
  console.log('[cloudbase-mcp] READY after daemon refresh; existing authorization reused, start_auth was not called.')
  process.exit(0)
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
