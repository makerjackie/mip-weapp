const APP_ID_PATTERN = /^wx[0-9a-f]{16}$/i
const PLAN_KEY_PATTERN = /^[a-z0-9][a-z0-9_-]{1,63}$/

export function resolveOwnerTestMembershipCommand({ args = [], env = {}, functionName }) {
  const operation = exactArgument(args, '--operation=').toLowerCase()
  const planKey = exactArgument(args, '--plan-key=')
  const envId = String(env.CLOUDBASE_ENV_ID || '').trim()
  const appId = String(env.MINI_PROGRAM_APP_ID || '').trim()
  const deploymentStage = String(env.MIP_DEPLOYMENT_STAGE || '').trim().toLowerCase()
  const catalogStage = String(env.MIP_CATALOG_STAGE || 'TEST').trim().toUpperCase()
  const paymentMode = String(env.MIP_PAYMENT_MODE || 'disabled').trim().toLowerCase()
  const allowedAppIds = String(env.MIP_ALLOWED_APP_IDS || appId)
    .split(',')
    .map(value => value.trim())
    .filter(Boolean)
  if (!['grant', 'revoke'].includes(operation)
    || !PLAN_KEY_PATTERN.test(planKey)
    || !envId
    || !APP_ID_PATTERN.test(appId)
    || exactArgument(args, '--confirm-env=') !== envId
    || exactArgument(args, '--confirm-app-id=') !== appId
    || exactArgument(args, '--confirm-ledger=') !== functionName
    || exactArgument(args, '--confirm-catalog=') !== 'TEST'
    || exactArgument(args, '--confirm-test-membership=') !== operation
    || !args.includes('--confirm-owner')) {
    throw new Error('Owner TEST membership requires exact operation, owner, environment, AppID, ledger, catalog, and operation confirmations')
  }
  if (!['development', 'test'].includes(deploymentStage)
    || catalogStage !== 'TEST'
    || !['disabled', 'test'].includes(paymentMode)) {
    throw new Error('Owner TEST membership is restricted to development/test with the TEST catalog and non-live payment mode')
  }
  if (!allowedAppIds.includes(appId)
    || allowedAppIds.some(value => !APP_ID_PATTERN.test(value))) {
    throw new Error('MIP_ALLOWED_APP_IDS must contain valid AppIDs and include MINI_PROGRAM_APP_ID')
  }
  return Object.freeze({
    operation,
    action: operation === 'grant' ? 'grantOwnerTestMembership' : 'revokeOwnerTestMembership',
    planKey,
    envId,
    appId,
    deploymentStage,
    catalogStage,
    paymentMode,
    functionName,
  })
}

export function assertDeployedOwnerTestMembership(config, variables = {}) {
  const allowedAppIds = String(variables.MIP_ALLOWED_APP_IDS || '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean)
  const secret = String(variables.MIP_TEST_MEMBERSHIP_HMAC_SECRET || '')
  if (!allowedAppIds.includes(config.appId)
    || variables.MIP_DEPLOYMENT_STAGE !== config.deploymentStage
    || variables.MIP_CATALOG_STAGE !== 'TEST'
    || variables.MIP_PAYMENT_MODE !== config.paymentMode
    || !['disabled', 'test'].includes(variables.MIP_PAYMENT_MODE)
    || secret.length < 32
    || /[\r\n]/.test(secret)) {
    throw new Error('Deployed payment ledger is not enabled for the confirmed Owner TEST membership boundary')
  }
  return secret
}

export function ownerTestMembershipSummary(operation, value) {
  const expectedOperation = operation.toUpperCase()
  if (!value
    || value.operation !== expectedOperation
    || !['ACTIVE', 'INACTIVE'].includes(value.status)
    || typeof value.membershipActive !== 'boolean'
    || typeof value.managed !== 'boolean'
    || typeof value.idempotent !== 'boolean') {
    throw new Error('Owner TEST membership invocation returned an invalid result')
  }
  return {
    operation: value.operation,
    status: value.status,
    membershipActive: value.membershipActive,
    managed: value.managed,
    idempotent: value.idempotent,
  }
}

function exactArgument(args, prefix) {
  const matches = args.filter(value => value.startsWith(prefix))
  if (matches.length !== 1) {
    return ''
  }
  return matches[0].slice(prefix.length)
}
