'use strict'

const { randomBytes } = require('node:crypto')
const cloud = require('wx-server-sdk')
const { createRefundDispatchService } = require('./domain/refund-dispatch')
const { verifyInternalEvent } = require('./lib/internal-auth')
const { createLedgerClient } = require('./lib/ledger-client')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const config = {
  envId: process.env.CLOUDBASE_ENV_ID || '',
  appId: process.env.MIP_APP_ID || '',
  merchantId: process.env.WECHAT_PAY_MERCHANT_ID || '',
  callbackFunction: process.env.MIP_PAYMENT_CALLBACK_FUNCTION || 'mip-cloudpay-callback',
  paymentMode: process.env.MIP_PAYMENT_MODE || 'disabled',
}
const allowedAppIds = new Set(
  String(process.env.MIP_ALLOWED_APP_IDS || config.appId)
    .split(',')
    .map(value => value.trim())
    .filter(Boolean),
)
let initializedLedgerClient
function callLedger(action, appId, data) {
  initializedLedgerClient ||= createLedgerClient({
    cloud,
    functionName: process.env.MIP_LEDGER_FUNCTION || 'mip-payment-ledger',
    secret: process.env.MIP_LEDGER_SECRET || '',
  })
  return initializedLedgerClient(action, appId, data)
}
const service = createRefundDispatchService({
  cloudPay: cloud.cloudPay,
  callLedger,
  config,
  nonce: () => randomBytes(16).toString('hex'),
  onError: error => console.error('[mip-refund-worker] batch item failed', errorCode(error)),
})

exports.main = async (event = {}) => {
  if (event.action === 'health') {
    return {
      ok: true,
      data: {
        service: 'mip-refund-worker',
        provider: 'cloudbase-native-cloudpay',
        configReady: service.configReady,
        paymentMode: config.paymentMode,
      },
    }
  }
  try {
    const request = verifyInternalEvent(event, {
      allowedAppIds,
      secret: process.env.MIP_REFUND_WORKER_HMAC_SECRET,
    })
    if (request.action === 'dispatchRefund') {
      return { ok: true, data: await service.dispatchRefund(request.appId, request) }
    }
    if (request.action === 'dispatchRefunds') {
      return { ok: true, data: await service.dispatchRefunds(request.appId, request) }
    }
    if (request.action === 'runBatch') {
      return { ok: true, data: await service.runBatch(request.appId, request) }
    }
    throw new Error('UNSUPPORTED_ACTION')
  }
  catch (error) {
    const code = errorCode(error)
    console.error('[mip-refund-worker]', event.action, code)
    return { ok: false, error: { code } }
  }
}

function errorCode(error) {
  return error instanceof Error && /^[A-Z][A-Z0-9_]+$/.test(error.message)
    ? error.message
    : 'INTERNAL_ERROR'
}

exports._test = { verifyInternalEvent }
