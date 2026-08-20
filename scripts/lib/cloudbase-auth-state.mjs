export const CLOUD_BASE_AUTH_STATES = Object.freeze({
  READY: 'READY',
  PENDING: 'PENDING',
  REQUIRED: 'REQUIRED',
  ERROR: 'ERROR',
})

const STATUS_FIELDS = [
  'auth_status',
  'authStatus',
  'authentication_status',
  'authenticationStatus',
  'status',
  'state',
]

const STATUS_ALIASES = new Map([
  ['READY', CLOUD_BASE_AUTH_STATES.READY],
  ['PENDING', CLOUD_BASE_AUTH_STATES.PENDING],
  ['REQUIRED', CLOUD_BASE_AUTH_STATES.REQUIRED],
  ['AUTH_REQUIRED', CLOUD_BASE_AUTH_STATES.REQUIRED],
  ['ERROR', CLOUD_BASE_AUTH_STATES.ERROR],
])

function statusValue(value) {
  if (typeof value === 'string') {
    return value
  }
  if (!value || typeof value !== 'object') {
    return undefined
  }
  for (const field of STATUS_FIELDS) {
    if (typeof value[field] === 'string') {
      return value[field]
    }
  }
  return undefined
}

export function normalizeCloudbaseAuthStatus(value) {
  const raw = statusValue(value)
  return typeof raw === 'string' ? raw.trim().toUpperCase() : ''
}

/**
 * Convert the MCP auth status vocabulary into the four states consumed by the
 * status and explicit-auth commands. Unknown and missing values are errors so
 * a malformed MCP response can never trigger a new authorization request.
 */
export function classifyCloudbaseAuthState(value) {
  return STATUS_ALIASES.get(normalizeCloudbaseAuthStatus(value)) || CLOUD_BASE_AUTH_STATES.ERROR
}

export function classifyCloudbaseEnvState(value) {
  const normalized = normalizeCloudbaseAuthStatus(value)
  if (normalized === 'NONE') {
    return 'NONE'
  }
  return STATUS_ALIASES.get(normalized) || CLOUD_BASE_AUTH_STATES.ERROR
}

export function classifyCloudbaseAuthStatus(value) {
  const authStatus = value && typeof value === 'object'
    ? value.authStatus ?? value.auth_status
    : value
  const envStatus = value && typeof value === 'object'
    ? value.envStatus ?? value.env_status
    : undefined
  return {
    authStatus: classifyCloudbaseAuthState(authStatus),
    envStatus: classifyCloudbaseEnvState(envStatus),
  }
}

export function isCloudbaseAuthReady(value) {
  return classifyCloudbaseAuthState(value) === CLOUD_BASE_AUTH_STATES.READY
}
