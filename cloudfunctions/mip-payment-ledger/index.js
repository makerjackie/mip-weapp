'use strict'

const cloud = require('wx-server-sdk')
const ledger = require('./domain/ledger')
const ownerTestMembership = require('./domain/owner-test-membership')
const { assertInternalRequest } = require('./lib/internal-auth')
const { mysqlDatabase } = require('./lib/mysql')
const { createOutboxWakeup } = require('./lib/outbox-wakeup')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const allowedAppIds = new Set(
  String(process.env.MIP_ALLOWED_APP_IDS || '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean),
)
const authOptions = {
  allowedAppIds,
  secrets: [process.env.MIP_LEDGER_SECRET, process.env.MIP_LEDGER_PREVIOUS_SECRET],
}
const ownerTestMembershipActions = new Set([
  'grantOwnerTestMembership',
  'revokeOwnerTestMembership',
])
const ownerTestMembershipAuthOptions = {
  allowedAppIds,
  secrets: [process.env.MIP_TEST_MEMBERSHIP_HMAC_SECRET],
}
const ownerTestMembershipEnvironment = Object.freeze({
  deploymentStage: process.env.MIP_DEPLOYMENT_STAGE,
  catalogStage: process.env.MIP_CATALOG_STAGE,
  paymentMode: process.env.MIP_PAYMENT_MODE,
})
const outboxMutationActions = new Set([
  'applyPaymentCallback',
  'applyRefundCallback',
  ...ownerTestMembershipActions,
])
const outboxWakeup = createOutboxWakeup({
  cloud,
  functionName: process.env.MIP_OUTBOX_FUNCTION_NAME,
  secret: process.env.MIP_OUTBOX_HMAC_SECRET,
  sourceFunctionName: 'mip-payment-ledger',
  logger: console,
})
const handlers = Object.freeze(Object.assign(Object.create(null), {
  getPayableOrder: (db, event, appId) => ledger.getPayableOrder(db, { ...event, appId }),
  markPaymentCreated: (db, event, appId) => ledger.markPaymentCreated(db, { ...event, appId }),
  applyPaymentCallback: (db, event, appId) => ledger.applyPaymentCallback(db, { ...event, appId }),
  getRefundRequest: (db, event, appId) => ledger.getRefundRequest(db, { ...event, appId }),
  getRefundRequestForProvider: (db, event, appId) => ledger.getRefundRequestForProvider(db, { ...event, appId }),
  listPendingRefunds: (db, event, appId) => ledger.listPendingRefunds(db, { ...event, appId }),
  markRefundCreated: (db, event, appId) => ledger.markRefundCreated(db, { ...event, appId }),
  markRefundFailed: (db, event, appId) => ledger.markRefundFailed(db, { ...event, appId }),
  markRefundManualReview: (db, event, appId) => ledger.markRefundManualReview(db, { ...event, appId }),
  applyRefundCallback: (db, event, appId) => ledger.applyRefundCallback(db, { ...event, appId }),
  grantOwnerTestMembership: (db, event, appId) => ownerTestMembership.grantOwnerTestMembership(db, {
    ...event,
    ...ownerTestMembershipEnvironment,
    appId,
  }),
  revokeOwnerTestMembership: (db, event, appId) => ownerTestMembership.revokeOwnerTestMembership(db, {
    ...event,
    ...ownerTestMembershipEnvironment,
    appId,
  }),
}))

exports.main = async (event = {}) => {
  const request = event && typeof event === 'object' ? event : {}
  let action = ''
  try {
    action = Object.hasOwn(request, 'action') && typeof request.action === 'string'
      ? request.action
      : ''
    if (action === 'health') {
      await mysqlDatabase().one('SELECT 1 AS ok')
      return { ok: true, data: { service: 'mip-payment-ledger', persistence: 'cloudbase-mysql' } }
    }
    const appId = assertInternalRequest(
      request,
      ownerTestMembershipActions.has(action) ? ownerTestMembershipAuthOptions : authOptions,
    )
    if (!Object.hasOwn(handlers, action)) {
      throw new Error('UNSUPPORTED_ACTION')
    }
    const handler = handlers[action]
    const data = await handler(mysqlDatabase(), request, appId)
    await outboxWakeup.afterSuccessfulMutation({
      appId,
      action,
      mutationActions: outboxMutationActions,
    })
    return { ok: true, data }
  }
  catch (error) {
    const code = error instanceof Error && /^[A-Z][A-Z0-9_:]+$/.test(error.message)
      ? error.message
      : 'INTERNAL_ERROR'
    console.error('[mip-payment-ledger]', action || 'unknown', code)
    return { ok: false, error: { code } }
  }
}

exports._test = {
  assertInternalRequest,
  handlers,
  outboxMutationActions,
  ownerTestMembershipActions,
  ownerTestMembershipEnvironment,
}
