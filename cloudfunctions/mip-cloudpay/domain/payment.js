'use strict'

const { createHash, randomUUID } = require('node:crypto')

const allowedSignTypes = new Set(['MD5', 'HMAC-SHA256', 'RSA'])

function createPaymentService(options) {
  const config = options.config
  const configReady = Boolean(
    config.envId
    && /^wx[0-9a-f]{16}$/i.test(config.appId)
    && /^\d{6,32}$/.test(config.merchantId)
    && config.callbackFunction
    && ['test', 'live'].includes(config.paymentMode),
  )

  function assertReady() {
    if (!configReady) {
      throw new Error('PAYMENT_CONFIG_REQUIRED')
    }
  }

  async function createPayment(caller, value) {
    assertReady()
    const orderId = uuid(value?.orderId, 'INVALID_PAYMENT_REQUEST')
    const order = await options.callLedger('getPayableOrder', {
      orderId,
      identityKey: caller.identityKey,
      paymentMode: config.paymentMode,
    })
    assertPayableOrder(order)
    if (!['CREATED', 'PAYMENT_CREATED'].includes(order.status)) {
      throw new Error('INVALID_PAYMENT_ORDER')
    }
    const result = await options.cloudPay.unifiedOrder({
      envId: config.envId,
      functionName: config.callbackFunction,
      subMchId: config.merchantId,
      subAppid: caller.appId,
      subOpenid: caller.openId,
      nonceStr: options.nonce(),
      body: String(order.description || 'MIP 订单').slice(0, 120),
      attach: JSON.stringify({ version: 1, orderId: order.id }),
      outTradeNo: order.merchantOrderNo,
      totalFee: order.amountCents,
      spbillCreateIp: '127.0.0.1',
      tradeType: 'JSAPI',
    })
    const payment = normalizePayment(result?.payment)
    await options.callLedger('markPaymentCreated', {
      orderId: order.id,
      identityKey: caller.identityKey,
      merchantOrderNo: order.merchantOrderNo,
      amountCents: order.amountCents,
      currency: order.currency,
      attemptId: randomUUID(),
      requestHash: createHash('sha256')
        .update(`${caller.appId}\0${order.id}\0${payment.package}`)
        .digest('hex'),
      prepayId: payment.package.slice('prepay_id='.length),
      provider: config.paymentMode === 'test' ? 'TEST' : 'WECHAT_PAY',
    })
    return { payment }
  }

  async function syncPayment(caller, value) {
    assertReady()
    const orderId = uuid(value?.orderId, 'INVALID_PAYMENT_REQUEST')
    const order = await options.callLedger('getPayableOrder', {
      orderId,
      identityKey: caller.identityKey,
      paymentMode: config.paymentMode,
    })
    assertPayableOrder(order)
    if (order.status === 'PAID') {
      return { status: 'PAID' }
    }
    const result = await options.cloudPay.queryOrder({
      subMchId: config.merchantId,
      subAppid: caller.appId,
      nonceStr: options.nonce(),
      outTradeNo: order.merchantOrderNo,
    })
    if (!successful(result)) {
      throw new Error('PAYMENT_QUERY_UNAVAILABLE')
    }
    const record = paymentRecord(result)
    if (record.status !== 'SUCCESS') {
      return { status: 'PAYMENT_CREATED' }
    }
    if (record.merchantOrderNo !== order.merchantOrderNo
      || (record.openId && record.openId !== caller.openId)
      || !record.providerTransactionId
      || record.amountCents !== order.amountCents
      || record.currency !== order.currency) {
      throw new Error('PAYMENT_QUERY_MISMATCH')
    }
    const applied = await options.callLedger('applyPaymentCallback', {
      orderId: order.id,
      identityKey: caller.identityKey,
      merchantOrderNo: order.merchantOrderNo,
      providerTransactionId: record.providerTransactionId,
      amountCents: record.amountCents,
      currency: record.currency,
    })
    return { status: applied.status }
  }

  async function submitRefund(caller, value) {
    assertReady()
    const refundId = uuid(value?.refundId, 'INVALID_REFUND_REQUEST')
    const refund = await options.callLedger('getRefundRequest', {
      refundId,
      identityKey: caller.identityKey,
    })
    assertRefund(refund)
    if (refund.manualReview) {
      throw new Error('REFUND_MANUAL_REVIEW')
    }
    const result = await options.cloudPay.refund({
      envId: config.envId,
      functionName: config.callbackFunction,
      subMchId: config.merchantId,
      nonceStr: options.nonce(),
      outTradeNo: refund.merchantOrderNo,
      outRefundNo: refund.merchantRefundNo,
      totalFee: refund.totalCents,
      refundFee: refund.amountCents,
      refundFeeType: refund.currency,
      refundDesc: String(refund.reason || 'MIP 订单退款').slice(0, 80),
    })
    if (!successful(result)) {
      throw new Error('REFUND_UNAVAILABLE')
    }
    await options.callLedger('markRefundCreated', {
      refundId,
      merchantRefundNo: refund.merchantRefundNo,
      providerRefundId: pick(result, 'refundId', 'refund_id'),
    })
    return { status: 'PROVIDER_CREATED' }
  }

  async function syncRefund(caller, value) {
    assertReady()
    const refundId = uuid(value?.refundId, 'INVALID_REFUND_REQUEST')
    const refund = await options.callLedger('getRefundRequest', {
      refundId,
      identityKey: caller.identityKey,
    })
    assertRefund(refund)
    const result = await options.cloudPay.queryRefund({
      subMchId: config.merchantId,
      nonceStr: options.nonce(),
      outRefundNo: refund.merchantRefundNo,
    })
    if (!successful(result)) {
      throw new Error('REFUND_QUERY_UNAVAILABLE')
    }
    const record = refundRecord(result, refund.merchantRefundNo)
    if (!record) {
      return { status: refund.manualReview ? 'REFUND_MANUAL_REVIEW' : 'PROVIDER_CREATED' }
    }
    if (record.status === 'SUCCESS') {
      await options.callLedger('applyRefundCallback', {
        merchantOrderNo: refund.merchantOrderNo,
        merchantRefundNo: refund.merchantRefundNo,
        providerRefundId: String(record.providerRefundId || ''),
        amountCents: record.amountCents,
      })
      return { status: 'REFUNDED' }
    }
    if (record.status === 'CHANGE') {
      await options.callLedger('markRefundManualReview', {
        refundId,
        merchantRefundNo: refund.merchantRefundNo,
        reasonCode: 'CHANGE',
      })
      return { status: 'REFUND_MANUAL_REVIEW' }
    }
    if (record.status === 'REFUNDCLOSE') {
      await options.callLedger('markRefundFailed', {
        refundId,
        merchantRefundNo: refund.merchantRefundNo,
        reasonCode: 'REFUNDCLOSE',
      })
      return { status: 'REFUND_FAILED' }
    }
    return { status: refund.manualReview ? 'REFUND_MANUAL_REVIEW' : 'PROVIDER_CREATED' }
  }

  return { configReady, createPayment, submitRefund, syncPayment, syncRefund }
}

function assertPayableOrder(order) {
  if (!uuidValue(order?.id)
    || !validMerchantReference(order?.merchantOrderNo, 32)
    || !Number.isInteger(order?.amountCents)
    || order.amountCents < 1
    || order.currency !== 'CNY') {
    throw new Error('INVALID_PAYMENT_ORDER')
  }
}

function assertRefund(refund) {
  if (!uuidValue(refund?.id)
    || !validMerchantReference(refund?.merchantOrderNo, 32)
    || !validMerchantReference(refund?.merchantRefundNo, 64)
    || !Number.isInteger(refund?.amountCents)
    || !Number.isInteger(refund?.totalCents)
    || refund.amountCents < 1
    || refund.amountCents > refund.totalCents
    || refund.currency !== 'CNY') {
    throw new Error('INVALID_REFUND_REQUEST')
  }
}

function normalizePayment(payment) {
  const normalized = {
    timeStamp: String(payment?.timeStamp || ''),
    nonceStr: String(payment?.nonceStr || ''),
    package: String(payment?.package || ''),
    signType: String(payment?.signType || ''),
    paySign: String(payment?.paySign || ''),
  }
  if (!/^\d+$/.test(normalized.timeStamp)
    || !normalized.nonceStr
    || !/^prepay_id=.+/.test(normalized.package)
    || !allowedSignTypes.has(normalized.signType)
    || !normalized.paySign) {
    throw new Error('PAYMENT_UNAVAILABLE')
  }
  return normalized
}

function paymentRecord(result) {
  const resource = result?.resource && typeof result.resource === 'object' ? result.resource : result
  const amount = resource?.amount && typeof resource.amount === 'object' ? resource.amount : {}
  const payer = resource?.payer && typeof resource.payer === 'object' ? resource.payer : {}
  return {
    status: pick(resource, 'tradeState', 'trade_state'),
    merchantOrderNo: pick(resource, 'outTradeNo', 'out_trade_no'),
    providerTransactionId: pick(resource, 'transactionId', 'transaction_id'),
    openId: pick(resource, 'subOpenid', 'sub_openid', 'openid') || payer.openid,
    amountCents: Number(pick(resource, 'totalFee', 'total_fee') ?? amount.total),
    currency: pick(resource, 'feeType', 'fee_type') || amount.currency || 'CNY',
  }
}

function refundRecord(result, merchantRefundNo) {
  const numbers = pick(result, 'outRefundNoList', 'out_refund_no_list')
  const statuses = pick(result, 'refundStatusList', 'refund_status_list')
  const ids = pick(result, 'refundIdList', 'refund_id_list')
  const amounts = pick(result, 'refundFeeList', 'refund_fee_list')
  if (Array.isArray(numbers)) {
    const index = numbers.indexOf(merchantRefundNo)
    if (index >= 0) {
      return {
        status: Array.isArray(statuses) ? statuses[index] : undefined,
        providerRefundId: Array.isArray(ids) ? ids[index] : undefined,
        amountCents: Number(Array.isArray(amounts) ? amounts[index] : undefined),
      }
    }
  }
  if (pick(result, 'outRefundNo', 'out_refund_no') === merchantRefundNo) {
    return {
      status: pick(result, 'refundStatus', 'refund_status'),
      providerRefundId: pick(result, 'refundId', 'refund_id'),
      amountCents: Number(pick(result, 'refundFee', 'refund_fee')),
    }
  }
  return null
}

function successful(result) {
  const returnCode = pick(result, 'returnCode', 'return_code')
  const resultCode = pick(result, 'resultCode', 'result_code')
  return returnCode === 'SUCCESS' && (!resultCode || resultCode === 'SUCCESS')
}

function validMerchantReference(value, maximum) {
  return typeof value === 'string'
    && value.length >= 1
    && value.length <= maximum
    && /^[0-9A-Za-z_-]+$/.test(value)
}

function uuid(value, errorCode) {
  if (!uuidValue(value)) {
    throw new Error(errorCode)
  }
  return value
}

function uuidValue(value) {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

function pick(source, ...keys) {
  for (const key of keys) {
    if (source?.[key] !== undefined && source[key] !== null && source[key] !== '') {
      return source[key]
    }
  }
  return undefined
}

module.exports = {
  createPaymentService,
  normalizePayment,
  paymentRecord,
  refundRecord,
  successful,
  validMerchantReference,
}
