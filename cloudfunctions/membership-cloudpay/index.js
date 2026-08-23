'use strict'

const { randomBytes } = require('node:crypto')
const cloud = require('wx-server-sdk')
const { createPaymentService } = require('./domain/payment')
const { resolveTrustedIdentity } = require('./lib/identity')
const { createLedgerClient } = require('./lib/ledger-client')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const config = {
  envId: process.env.CLOUDBASE_ENV_ID || '',
  appId: process.env.MEMBERSHIP_APP_ID || '',
  merchantId: process.env.WECHAT_PAY_MERCHANT_ID || '',
  callbackFunction: process.env.MEMBERSHIP_CALLBACK_FUNCTION || 'mip-cloudpay-callback',
  paymentMode: process.env.MEMBERSHIP_PAYMENT_MODE || 'disabled',
}
const allowedAppIds = new Set(String(process.env.MEMBERSHIP_ALLOWED_APP_IDS || config.appId)
  .split(',')
  .map(value => value.trim())
  .filter(Boolean))

const callLedger = createLedgerClient({
  cloud,
  functionName: process.env.MEMBERSHIP_LEDGER_FUNCTION || 'mip-payment-ledger',
  appId: config.appId,
  secret: process.env.MEMBERSHIP_LEDGER_SECRET || '',
})
const service = createPaymentService({
  cloudPay: cloud.cloudPay,
  callLedger,
  config,
  nonce: () => randomBytes(16).toString('hex'),
})

function identity() {
  const context = cloud.getWXContext()
  const resolved = resolveTrustedIdentity(context, { errorCode: 'IDENTITY_REQUIRED' })
  if (!resolved.appId || resolved.appId !== config.appId || !allowedAppIds.has(resolved.appId)) {
    throw new Error('IDENTITY_REQUIRED')
  }
  return { appId: resolved.appId, userId: resolved.userId || resolved.openId }
}

function failure(error) {
  const code = error instanceof Error && /^[A-Z][A-Z0-9_]+$/.test(error.message)
    ? error.message
    : 'INTERNAL_ERROR'
  const messages = {
    IDENTITY_REQUIRED: '登录状态异常，请重新进入小程序',
    INVALID_PAYMENT_REQUEST: '支付请求无效，请重新下单',
    INVALID_REFUND_REQUEST: '退款请求无效',
    PAYMENT_CONFIG_REQUIRED: '当前环境未开启微信支付',
    PAYMENT_QUERY_MISMATCH: '支付订单校验失败，请联系客服处理',
    PAYMENT_QUERY_UNAVAILABLE: '支付结果确认失败，请稍后重试',
    PAYMENT_UNAVAILABLE: '支付服务暂时不可用，请稍后重试',
    REFUND_QUERY_UNAVAILABLE: '退款状态查询失败，请稍后重试',
    REFUND_CONFIRMATION_FORBIDDEN: '仅小程序负责人可以确认退款到账',
    REFUND_UNAVAILABLE: '退款提交失败，请稍后重试',
  }
  return { ok: false, error: { code, message: messages[code] || '支付服务暂时不可用' } }
}

exports.main = async (event = {}) => {
  if (event.action === 'health') {
    return {
      ok: true,
      data: {
        service: 'membership-cloudpay',
        provider: 'cloudbase-native-cloudpay',
        configReady: service.configReady,
        paymentMode: config.paymentMode,
        contractVersion: 3,
      },
    }
  }
  try {
    const caller = identity()
    if (event.action === 'createPayment') {
      return { ok: true, data: await service.createPayment({ orderId: event.orderId, userId: caller.userId }) }
    }
    if (event.action === 'syncPayment') {
      return { ok: true, data: await service.syncPayment({ orderId: event.orderId, userId: caller.userId }) }
    }
    if (event.action === 'submitRefund') {
      return { ok: true, data: await service.submitRefund({ refundId: event.refundId, userId: caller.userId }) }
    }
    if (event.action === 'syncRefund') {
      return { ok: true, data: await service.syncRefund({ refundId: event.refundId, userId: caller.userId }) }
    }
    if (event.action === 'confirmRefund') {
      return { ok: true, data: await service.confirmRefund({ refundId: event.refundId, userId: caller.userId }) }
    }
    throw new Error('UNSUPPORTED_ACTION')
  }
  catch (error) {
    console.error('[membership-cloudpay]', event.action, error instanceof Error ? error.message : 'INTERNAL_ERROR')
    return failure(error)
  }
}

module.exports._test = { identity, resolveTrustedIdentity }
