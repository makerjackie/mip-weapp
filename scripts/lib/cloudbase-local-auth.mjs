import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

export const CLOUDBASE_LOCAL_CREDENTIAL_STATES = Object.freeze({
  MISSING: 'MISSING',
  TMP_VALID: 'TMP_VALID',
  REFRESH_WINDOW_OPEN: 'REFRESH_WINDOW_OPEN',
  EXPIRED: 'EXPIRED',
  UNUSABLE: 'UNUSABLE',
})

function firstNonEmpty(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim()
    }
  }
  return ''
}

function isoOrNull(value) {
  const timestamp = Number(value)
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return null
  }
  return new Date(timestamp).toISOString()
}

export function parseDotEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return {}
  }
  return fs.readFileSync(filePath, 'utf8').split(/\r?\n/).reduce((result, line) => {
    const match = line.trim().match(/^([A-Z_]\w*)=(.*)$/i)
    if (match) {
      result[match[1]] = match[2].trim().replace(/^['"]|['"]$/g, '')
    }
    return result
  }, {})
}

export function localEnvPath(projectRoot) {
  return path.join(projectRoot, '.env.local')
}

export function loadCloudbaseManagementEnv(projectRoot, env = process.env) {
  const fileEnv = parseDotEnvFile(localEnvPath(projectRoot))
  const authMode = firstNonEmpty(env.CLOUDBASE_AUTH_MODE).toLowerCase()
  const localOnly = authMode === 'local'
  const apiKey = localOnly ? '' : firstNonEmpty(env.CLOUDBASE_API_KEY, fileEnv.CLOUDBASE_API_KEY)
  const envId = firstNonEmpty(env.CLOUDBASE_ENV_ID, fileEnv.CLOUDBASE_ENV_ID)
  return {
    authMode: localOnly ? 'local' : 'management-key',
    hasApiKey: Boolean(apiKey),
    hasEnvId: Boolean(envId),
    apiKey,
    envId,
  }
}

export function requireCloudbaseManagementEnv(projectRoot, env = process.env) {
  const loaded = loadCloudbaseManagementEnv(projectRoot, env)
  if (!loaded.hasApiKey) {
    throw new Error('CLOUDBASE_API_KEY is required in the project-root .env.local. Create an environment-level API Key; a publish_key is not accepted.')
  }
  if (!loaded.hasEnvId) {
    throw new Error('CLOUDBASE_ENV_ID is required with CLOUDBASE_API_KEY in the project-root .env.local.')
  }
  return loaded
}

export function hasExplicitDeviceAuthApproval(args = []) {
  return (args.length === 1 && args[0] === '--allow-device-auth')
    || (args.length === 2 && args[0] === '--' && args[1] === '--allow-device-auth')
}

export function applyCloudbaseManagementEnv(projectRoot, env = process.env) {
  const loaded = loadCloudbaseManagementEnv(projectRoot, env)
  if (loaded.authMode === 'local') {
    delete env.CLOUDBASE_API_KEY
  }
  if (loaded.apiKey && !firstNonEmpty(env.CLOUDBASE_API_KEY)) {
    env.CLOUDBASE_API_KEY = loaded.apiKey
  }
  if (loaded.envId && !firstNonEmpty(env.CLOUDBASE_ENV_ID)) {
    env.CLOUDBASE_ENV_ID = loaded.envId
  }
  return {
    hasApiKey: Boolean(firstNonEmpty(env.CLOUDBASE_API_KEY)),
    hasEnvId: Boolean(firstNonEmpty(env.CLOUDBASE_ENV_ID)),
  }
}

export function inspectLocalCloudbaseCredential(
  homeDirectory = os.homedir(),
  now = Date.now(),
) {
  const authPath = path.join(homeDirectory, '.config', '.cloudbase', 'auth.json')
  let stat
  try {
    stat = fs.lstatSync(authPath)
  }
  catch (error) {
    if (error?.code === 'ENOENT') {
      return {
        state: CLOUDBASE_LOCAL_CREDENTIAL_STATES.MISSING,
        present: false,
        hasRefreshToken: false,
        tmpExpiresAt: null,
        refreshExpiresAt: null,
      }
    }
    return {
      state: CLOUDBASE_LOCAL_CREDENTIAL_STATES.UNUSABLE,
      present: false,
      hasRefreshToken: false,
      tmpExpiresAt: null,
      refreshExpiresAt: null,
    }
  }
  if (!stat.isFile()) {
    return {
      state: CLOUDBASE_LOCAL_CREDENTIAL_STATES.UNUSABLE,
      present: false,
      hasRefreshToken: false,
      tmpExpiresAt: null,
      refreshExpiresAt: null,
    }
  }

  let credential
  try {
    const parsed = JSON.parse(fs.readFileSync(authPath, 'utf8'))
    credential = parsed?.credential && typeof parsed.credential === 'object'
      ? parsed.credential
      : null
  }
  catch {
    return {
      state: CLOUDBASE_LOCAL_CREDENTIAL_STATES.UNUSABLE,
      present: true,
      hasRefreshToken: false,
      tmpExpiresAt: null,
      refreshExpiresAt: null,
    }
  }
  if (!credential) {
    return {
      state: CLOUDBASE_LOCAL_CREDENTIAL_STATES.UNUSABLE,
      present: true,
      hasRefreshToken: false,
      tmpExpiresAt: null,
      refreshExpiresAt: null,
    }
  }

  const hasRefreshToken = typeof credential.refreshToken === 'string' && credential.refreshToken.length > 0
  const tmpExpiresAt = isoOrNull(credential.tmpExpired ?? credential.accessTokenExpired)
  const refreshExpiresAt = isoOrNull(credential.expired)
  const tmpExpiredAt = Number(credential.tmpExpired ?? credential.accessTokenExpired)
  const refreshExpiredAt = Number(credential.expired)
  const tmpValid = Number.isFinite(tmpExpiredAt) && tmpExpiredAt > now
  const refreshWindowOpen = Number.isFinite(refreshExpiredAt) && refreshExpiredAt > now

  let state = CLOUDBASE_LOCAL_CREDENTIAL_STATES.UNUSABLE
  if (tmpValid) {
    state = CLOUDBASE_LOCAL_CREDENTIAL_STATES.TMP_VALID
  }
  else if (hasRefreshToken && refreshWindowOpen) {
    state = CLOUDBASE_LOCAL_CREDENTIAL_STATES.REFRESH_WINDOW_OPEN
  }
  else if (hasRefreshToken) {
    state = CLOUDBASE_LOCAL_CREDENTIAL_STATES.EXPIRED
  }

  return {
    state,
    present: true,
    hasRefreshToken,
    tmpExpiresAt,
    refreshExpiresAt,
  }
}
