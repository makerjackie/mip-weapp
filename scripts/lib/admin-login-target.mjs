const callbackPath = '/api/internal/auth/challenge/confirm'
const defaultOrigins = Object.freeze({
  'mip-admin-api': 'https://admin.mip.cool',
  'mip-t-admin-api': 'https://test.admin.mip.cool',
})

export function exactAdminOrigin(value, { allowLoopback = false } = {}) {
  try {
    const url = new URL(String(value || '').trim())
    const loopback = allowLoopback && url.protocol === 'http:'
      && ['localhost', '127.0.0.1'].includes(url.hostname)
    if ((!loopback && url.protocol !== 'https:') || url.username || url.password
      || url.pathname !== '/' || url.search || url.hash) {
      throw new Error('invalid')
    }
    return url.origin
  }
  catch {
    throw new Error('Configure an exact admin HTTPS origin without credentials, path, query, or fragment')
  }
}

export function resolveAdminLoginCallbacks(env, adminFunctionName) {
  const origin = env.MIP_ADMIN_WEB_CLOUDBASE_ORIGIN || defaultOrigins[adminFunctionName]
  const fallback = origin ? `${exactAdminOrigin(origin)}${callbackPath}` : ''
  return {
    confirmUrl: exactEndpoint(env.MIP_ADMIN_WEB_LOGIN_CONFIRM_URL || fallback, 'MIP_ADMIN_WEB_LOGIN_CONFIRM_URL'),
    // This compatibility field still receives 9xxxxx codes and z_ scene tokens.
    migrationUrl: exactEndpoint(env.MIP_ADMIN_WEB_LOGIN_MIGRATION_URL || fallback, 'MIP_ADMIN_WEB_LOGIN_MIGRATION_URL'),
  }
}

function exactEndpoint(value, key) {
  try {
    const url = new URL(String(value || '').trim())
    if (url.protocol !== 'https:' || url.username || url.password || url.hash) {
      throw new Error('invalid')
    }
    return url.toString()
  }
  catch {
    throw new Error(`${key} must be an absolute HTTPS URL without credentials or fragment`)
  }
}
