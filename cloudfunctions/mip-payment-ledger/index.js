'use strict'

const ledger = require('./domain/ledger')
const { assertInternalRequest } = require('./lib/internal-auth')
const { mysqlDatabase } = require('./lib/mysql')

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
const handlers = {
  getPayableOrder: (db, event, appId) => ledger.getPayableOrder(db, { ...event, appId }),
  markPaymentCreated: (db, event, appId) => ledger.markPaymentCreated(db, { ...event, appId }),
  applyPaymentCallback: (db, event, appId) => ledger.applyPaymentCallback(db, { ...event, appId }),
  getRefundRequest: (db, event, appId) => ledger.getRefundRequest(db, { ...event, appId }),
  getRefundRequestForProvider: (db, event, appId) => ledger.getRefundRequestForProvider(db, { ...event, appId }),
  listPendingRefunds: (db, event, appId) => ledger.listPendingRefunds(db, { ...event, appId }),
  markRefundCreated: (db, event, appId) => ledger.markRefundCreated(db, { ...event, appId }),
  markRefundFailed: (db, event, appId) => ledger.markRefundFailed(db, { ...event, appId }),
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
    return { ok: true, data: await handler(mysqlDatabase(), event, appId) }
  }
  catch (error) {
    const code = error instanceof Error && /^[A-Z][A-Z0-9_:]+$/.test(error.message)
      ? error.message
      : 'INTERNAL_ERROR'
    console.error('[mip-payment-ledger]', event.action, code)
    return { ok: false, error: { code } }
  }
}

exports._test = { assertInternalRequest }
