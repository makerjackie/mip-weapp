export const MIP_FUNCTION_DEFAULTS = Object.freeze({
  api: 'mip-api',
  admin: 'mip-admin-api',
  ledger: 'mip-payment-ledger',
  notification: 'mip-notification-worker',
  pay: 'mip-cloudpay',
  callback: 'mip-cloudpay-callback',
})

export const MIP_FUNCTION_SOURCES = Object.freeze({
  api: 'membership-api',
  admin: 'membership-admin-api',
  ledger: 'membership-payment-ledger',
  notification: 'membership-notification-worker',
  pay: 'membership-cloudpay',
  callback: 'membership-cloudpay-callback',
})

const ENV_KEYS = Object.freeze({
  api: 'MEMBERSHIP_FUNCTION_NAME',
  admin: 'MEMBERSHIP_ADMIN_FUNCTION_NAME',
  ledger: 'MEMBERSHIP_LEDGER_FUNCTION_NAME',
  notification: 'MEMBERSHIP_NOTIFICATION_FUNCTION_NAME',
  pay: 'MEMBERSHIP_PAY_FUNCTION_NAME',
  callback: 'MEMBERSHIP_PAY_CALLBACK_FUNCTION',
})

export function resolveMipFunctionNames(env = {}) {
  const names = Object.fromEntries(Object.entries(ENV_KEYS).map(([role, envKey]) => [
    role,
    String(env[envKey] || MIP_FUNCTION_DEFAULTS[role]).trim(),
  ]))
  for (const [role, name] of Object.entries(names)) {
    if (!/^mip-[a-z0-9][a-z0-9-]{0,55}$/.test(name)) {
      throw new Error(`${ENV_KEYS[role]} must be a lowercase mip-* Cloud Function name`)
    }
  }
  if (new Set(Object.values(names)).size !== Object.keys(names).length) {
    throw new Error('MIP Cloud Function names must be unique')
  }
  return Object.freeze(names)
}
