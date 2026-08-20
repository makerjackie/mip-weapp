'use strict'

const ALLOWED_SIGN_TYPES = new Set(['MD5', 'HMAC-SHA256', 'RSA'])

function pick(source, ...keys) {
  for (const key of keys) {
    if (source?.[key] !== undefined && source[key] !== null && source[key] !== '') {
      return source[key]
    }
  }
  return undefined
}

function validUuid(value) {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

function validMerchantReference(value, maximum) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= maximum
    && /^[0-9A-Za-z_-]+$/.test(value)
}

function successful(result) {
  const returnCode = pick(result, 'returnCode', 'return_code')
  const resultCode = pick(result, 'resultCode', 'result_code')
  return returnCode === 'SUCCESS' && (!resultCode || resultCode === 'SUCCESS')
}

function normalizePayment(payment) {
  const signType = String(payment?.signType || '')
  const normalized = {
    timeStamp: String(payment?.timeStamp || ''),
    nonceStr: String(payment?.nonceStr || ''),
    package: String(payment?.package || ''),
    signType,
    paySign: String(payment?.paySign || ''),
  }
  if (!/^\d+$/.test(normalized.timeStamp)
    || !normalized.nonceStr
    || !/^prepay_id=.+/.test(normalized.package)
    || !ALLOWED_SIGN_TYPES.has(signType)
    || !normalized.paySign) {
    throw new Error('PAYMENT_UNAVAILABLE')
  }
  return normalized
}

function refundRecord(result, outRefundNo) {
  const refundNumbers = pick(result, 'outRefundNoList', 'out_refund_no_list')
  const refundStatuses = pick(result, 'refundStatusList', 'refund_status_list')
  const refundIds = pick(result, 'refundIdList', 'refund_id_list')
  const refundFees = pick(result, 'refundFeeList', 'refund_fee_list')
  if (Array.isArray(refundNumbers)) {
    const index = refundNumbers.findIndex(candidate => candidate === outRefundNo)
    if (index >= 0) {
      return {
        status: Array.isArray(refundStatuses) ? refundStatuses[index] : undefined,
        refundId: Array.isArray(refundIds) ? refundIds[index] : undefined,
        amountCents: Number(Array.isArray(refundFees) ? refundFees[index] : undefined),
      }
    }
  }
  const count = Math.min(Number(pick(result, 'refundCount', 'refund_count')) || 10, 50)
  for (let index = 0; index < count; index += 1) {
    const candidateNo = pick(result, `outRefundNo${index}`, `outRefundNo_${index}`, `out_refund_no_${index}`)
    if (candidateNo === outRefundNo) {
      return {
        status: pick(result, `refundStatus${index}`, `refundStatus_${index}`, `refund_status_${index}`),
        refundId: pick(result, `refundId${index}`, `refundId_${index}`, `refund_id_${index}`),
        amountCents: Number(pick(result, `refundFee${index}`, `refundFee_${index}`, `refund_fee_${index}`)),
      }
    }
  }
  if (pick(result, 'outRefundNo', 'out_refund_no') === outRefundNo) {
    return {
      status: pick(result, 'refundStatus', 'refund_status'),
      refundId: pick(result, 'refundId', 'refund_id'),
      amountCents: Number(pick(result, 'refundFee', 'refund_fee')),
    }
  }
  return null
}

function refundResponseShape(result) {
  return {
    keys: Object.keys(result || {}).sort().slice(0, 80),
    refundCount: Number(pick(result, 'refundCount', 'refund_count')) || 0,
  }
}

function paymentRecord(result) {
  const resource = result?.resource && typeof result.resource === 'object' ? result.resource : result
  const amount = resource?.amount && typeof resource.amount === 'object' ? resource.amount : {}
  const payer = resource?.payer && typeof resource.payer === 'object' ? resource.payer : {}
  return {
    status: pick(resource, 'tradeState', 'trade_state'),
    outTradeNo: pick(resource, 'outTradeNo', 'out_trade_no'),
    transactionId: pick(resource, 'transactionId', 'transaction_id'),
    userId: pick(resource, 'subOpenid', 'sub_openid', 'openid') || payer.openid,
    amountCents: Number(pick(resource, 'totalFee', 'total_fee') ?? amount.total),
    currency: pick(resource, 'feeType', 'fee_type') || amount.currency || 'CNY',
  }
}

function createPaymentService({ cloudPay, callLedger, config, nonce }) {
  const paymentConfigReady = Boolean(
    config.envId
    && /^wx[0-9a-f]{16}$/i.test(config.appId)
    && /^\d{6,32}$/.test(config.merchantId)
    && config.callbackFunction,
  )

  function assertReady() {
    if (!paymentConfigReady || !['test', 'live'].includes(config.paymentMode)) {
      throw new Error('PAYMENT_CONFIG_REQUIRED')
    }
  }

  async function createPayment({ orderId, userId }) {
    assertReady()
    if (!validUuid(orderId) || !userId) throw new Error('INVALID_PAYMENT_REQUEST')
    const order = await callLedger('getPayableOrder', {
      orderId,
      userId,
      paymentMode: config.paymentMode,
    })
    if (!validMerchantReference(order.outTradeNo, 32)
      || !Number.isInteger(order.amountCents)
      || order.amountCents <= 0
      || order.currency !== 'CNY') {
      throw new Error('INVALID_PAYMENT_ORDER')
    }
    const result = await cloudPay.unifiedOrder({
      envId: config.envId,
      functionName: config.callbackFunction,
      subMchId: config.merchantId,
      subAppid: config.appId,
      subOpenid: userId,
      nonceStr: nonce(),
      body: String(order.description || '会员服务').slice(0, 120),
      attach: JSON.stringify({ version: 1, orderId: order.id }),
      outTradeNo: order.outTradeNo,
      totalFee: order.amountCents,
      spbillCreateIp: '127.0.0.1',
      tradeType: 'JSAPI',
    })
    const payment = normalizePayment(result?.payment)
    await callLedger('markPaymentCreated', {
      orderId: order.id,
      userId,
      outTradeNo: order.outTradeNo,
      amountCents: order.amountCents,
      currency: order.currency,
    })
    return { payment }
  }

  async function syncPayment({ orderId, userId }) {
    assertReady()
    if (!validUuid(orderId) || !userId) throw new Error('INVALID_PAYMENT_REQUEST')
    const order = await callLedger('getPayableOrder', {
      orderId,
      userId,
      paymentMode: config.paymentMode,
    })
    const result = await cloudPay.queryOrder({
      subMchId: config.merchantId,
      subAppid: config.appId,
      nonceStr: nonce(),
      outTradeNo: order.outTradeNo,
    })
    if (!successful(result)) throw new Error('PAYMENT_QUERY_UNAVAILABLE')
    const record = paymentRecord(result)
    if (record.status !== 'SUCCESS') {
      return { status: 'PAYMENT_CREATED' }
    }
    if (record.outTradeNo !== order.outTradeNo
      || (record.userId && record.userId !== userId)
      || record.transactionId === undefined
      || !Number.isInteger(record.amountCents)
      || record.amountCents !== order.amountCents
      || record.currency !== order.currency) {
      throw new Error('PAYMENT_QUERY_MISMATCH')
    }
    await callLedger('applyPaymentCallback', {
      orderId: order.id,
      userId,
      outTradeNo: order.outTradeNo,
      transactionId: String(record.transactionId),
      amountCents: record.amountCents,
      currency: record.currency,
    })
    return { status: 'PAID' }
  }

  async function submitRefund({ refundId, userId }) {
    assertReady()
    if (!validUuid(refundId) || !userId) throw new Error('INVALID_REFUND_REQUEST')
    const refund = await callLedger('getRefundRequest', { refundId, userId })
    if (!validMerchantReference(refund.outTradeNo, 32)
      || !validMerchantReference(refund.outRefundNo, 64)
      || !Number.isInteger(refund.amountCents)
      || refund.amountCents <= 0
      || refund.amountCents !== refund.totalCents
      || refund.currency !== 'CNY') {
      throw new Error('INVALID_REFUND_REQUEST')
    }
    const result = await cloudPay.refund({
      envId: config.envId,
      functionName: config.callbackFunction,
      subMchId: config.merchantId,
      nonceStr: nonce(),
      outTradeNo: refund.outTradeNo,
      outRefundNo: refund.outRefundNo,
      totalFee: refund.totalCents,
      refundFee: refund.amountCents,
      refundFeeType: refund.currency,
      refundDesc: String(refund.reason || '会员订单全额退款').slice(0, 80),
    })
    if (!successful(result)) throw new Error('REFUND_UNAVAILABLE')
    await callLedger('markRefundCreated', {
      outTradeNo: refund.outTradeNo,
      outRefundNo: refund.outRefundNo,
    })
    return { status: 'REFUND_CREATED' }
  }

  async function syncRefund({ refundId, userId }) {
    assertReady()
    if (!validUuid(refundId) || !userId) throw new Error('INVALID_REFUND_REQUEST')
    const refund = await callLedger('getRefundRequest', { refundId, userId })
    if (!validMerchantReference(refund.outRefundNo, 64)) throw new Error('INVALID_REFUND_REQUEST')
    const result = await cloudPay.queryRefund({
      subMchId: config.merchantId,
      nonceStr: nonce(),
      outRefundNo: refund.outRefundNo,
    })
    if (!successful(result)) throw new Error('REFUND_QUERY_UNAVAILABLE')
    const record = refundRecord(result, refund.outRefundNo)
    if (!record) {
      // Deliberately log field names/counts only. Payment references and user
      // identifiers must never be copied into diagnostics.
      console.warn('[membership-cloudpay] refund query shape', refundResponseShape(result))
      return { status: 'REFUND_CREATED' }
    }
    if (record.status === 'SUCCESS') {
      await callLedger('applyRefundCallback', {
        outTradeNo: refund.outTradeNo,
        outRefundNo: refund.outRefundNo,
        refundId: String(record.refundId || ''),
        refundAmountCents: record.amountCents,
      })
      return { status: 'REFUNDED' }
    }
    if (record.status === 'REFUNDCLOSE' || record.status === 'CHANGE') {
      await callLedger('markRefundFailed', {
        outTradeNo: refund.outTradeNo,
        outRefundNo: refund.outRefundNo,
        reasonCode: record.status,
      })
      return { status: 'REFUND_FAILED' }
    }
    return { status: 'REFUND_CREATED' }
  }

  async function confirmRefund({ refundId, userId }) {
    assertReady()
    if (!validUuid(refundId) || !userId) throw new Error('INVALID_REFUND_REQUEST')
    const refund = await callLedger('getRefundRequest', { refundId, userId })
    if (refund.adminRole !== 'owner') throw new Error('REFUND_CONFIRMATION_FORBIDDEN')
    await callLedger('confirmRefundManually', {
      refundId,
      operatorId: userId,
      reason: '微信支付账单已确认退款到账',
    })
    return { status: 'REFUNDED' }
  }

  return {
    configReady: paymentConfigReady,
    confirmRefund,
    createPayment,
    syncPayment,
    submitRefund,
    syncRefund,
  }
}

module.exports = {
  createPaymentService,
  normalizePayment,
  paymentRecord,
  refundRecord,
  refundResponseShape,
  successful,
  validMerchantReference,
  validUuid,
}
