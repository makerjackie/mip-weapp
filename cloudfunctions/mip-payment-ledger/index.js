'use strict'

const cloud = require('wx-server-sdk')
const ledger = require('./domain/ledger')
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
const outboxMutationActions = new Set(['applyPaymentCallback', 'applyRefundCallback'])
const outboxWakeup = createOutboxWakeup({
  cloud,
  functionName: process.env.MIP_OUTBOX_FUNCTION_NAME,
  secret: process.env.MIP_OUTBOX_HMAC_SECRET,
  sourceFunctionName: 'mip-payment-ledger',
  logger: console,
})
const handlers = {
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
}

exports.main = async (event = {}) => {
  try {
    if (event.action === 'health') {
      await mysqlDatabase().one('SELECT 1 AS ok')
      return { ok: true, data: { service: 'mip-payment-ledger', persistence: 'cloudbase-mysql' } }
    }
    const appId = assertInternalRequest(event, authOptions)
    const handler = handlers[event.action]
    if (!handler) {
      throw new Error('UNSUPPORTED_ACTION')
    }
    const data = await handler(mysqlDatabase(), event, appId)
    await outboxWakeup.afterSuccessfulMutation({
      appId,
      action: String(event.action || ''),
      mutationActions: outboxMutationActions,
    })
    return { ok: true, data }
  }
  catch (error) {
    const code = error instanceof Error && /^[A-Z][A-Z0-9_:]+$/.test(error.message)
      ? error.message
      : 'INTERNAL_ERROR'
    console.error('[mip-payment-ledger]', event.action, code)
    return { ok: false, error: { code } }
  }
}

exports._test = { assertInternalRequest, outboxMutationActions }
