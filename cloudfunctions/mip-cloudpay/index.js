'use strict'

const { randomBytes } = require('node:crypto')
const cloud = require('wx-server-sdk')
const { createPaymentService } = require('./domain/payment')
const { resolveTrustedIdentity } = require('./lib/identity')
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
function callLedger(action, data) {
  initializedLedgerClient ||= createLedgerClient({
    cloud,
    functionName: process.env.MIP_LEDGER_FUNCTION || 'mip-payment-ledger',
    appId: config.appId,
    secret: process.env.MIP_LEDGER_SECRET || '',
  })
  return initializedLedgerClient(action, data)
}
const service = createPaymentService({
  cloudPay: cloud.cloudPay,
  callLedger,
  config,
  nonce: () => randomBytes(16).toString('hex'),
})

function caller() {
  return resolveTrustedIdentity(cloud.getWXContext(), {
    allowedAppIds,
    pepper: process.env.MIP_IDENTITY_PEPPER,
  })
}

exports.main = async (event = {}) => {
  if (event.action === 'health') {
    return {
      ok: true,
      data: {
        service: 'mip-cloudpay',
        provider: 'cloudbase-native-cloudpay',
        configReady: service.configReady,
        paymentMode: config.paymentMode,
      },
    }
  }
  try {
    const identity = caller()
    const method = service[event.action]
    if (typeof method !== 'function') {
      throw new Error('UNSUPPORTED_ACTION')
    }
    return { ok: true, data: await method(identity, event) }
  }
  catch (error) {
    const code = error instanceof Error && /^[A-Z][A-Z0-9_]+$/.test(error.message)
      ? error.message
      : 'INTERNAL_ERROR'
    console.error('[mip-cloudpay]', event.action, code)
    return { ok: false, error: { code, message: messageFor(code) } }
  }
}

function messageFor(code) {
  return ({
    IDENTITY_REQUIRED: '登录状态异常，请重新进入小程序',
    IDENTITY_CONFIG_REQUIRED: '身份服务尚未配置',
    INVALID_PAYMENT_REQUEST: '支付请求无效，请重新下单',
    INVALID_REFUND_REQUEST: '退款请求无效',
    PAYMENT_CONFIG_REQUIRED: '当前环境未开启微信支付',
    PAYMENT_QUERY_MISMATCH: '支付订单校验失败，请联系客服处理',
    PAYMENT_QUERY_UNAVAILABLE: '支付结果确认失败，请稍后重试',
    PAYMENT_UNAVAILABLE: '支付服务暂时不可用，请稍后重试',
    REFUND_QUERY_UNAVAILABLE: '退款状态查询失败，请稍后重试',
    REFUND_UNAVAILABLE: '退款提交失败，请稍后重试',
  })[code] || '支付服务暂时不可用'
}

exports._test = { caller, resolveTrustedIdentity }
