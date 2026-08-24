'use strict'

function createCallbackHandler(options) {
  return async function handle(event) {
    const resource = callbackResource(event)
    const callbackAppId = pick(resource, 'subAppid', 'sub_appid', 'appid')
    if (callbackAppId && callbackAppId !== options.appId) {
      throw new Error('CALLBACK_APP_MISMATCH')
    }
    const merchantRefundNo = pick(resource, 'outRefundNo', 'out_refund_no')
    if (merchantRefundNo) {
      if (!refundSucceeded(resource)) {
        throw new Error('REFUND_CALLBACK_NOT_SUCCESSFUL')
      }
      const merchantOrderNo = pick(resource, 'outTradeNo', 'out_trade_no')
      const providerRefundId = pick(resource, 'refundId', 'refund_id')
      const amountCents = Number(pick(resource, 'refundFee', 'refund_fee'))
      if (!merchantOrderNo
        || !providerRefundId
        || !Number.isInteger(amountCents)
        || amountCents < 1) {
        throw new Error('REFUND_CALLBACK_INVALID')
      }
      await options.callLedger('applyRefundCallback', {
        merchantOrderNo,
        merchantRefundNo,
        providerRefundId,
        amountCents,
      })
      return { kind: 'refund' }
    }
    if (!paymentSucceeded(resource)) {
      throw new Error('PAYMENT_CALLBACK_NOT_SUCCESSFUL')
    }
    const attach = parseAttach(pick(resource, 'attach'))
    const openId = pick(resource, 'subOpenid', 'sub_openid', 'openid')
      || nested(resource, 'payer', 'openid')
    const merchantOrderNo = pick(resource, 'outTradeNo', 'out_trade_no')
    const providerTransactionId = pick(resource, 'transactionId', 'transaction_id')
    const amountCents = Number(
      pick(resource, 'totalFee', 'total_fee')
      ?? nested(resource, 'amount', 'total'),
    )
    const currency = pick(resource, 'feeType', 'fee_type')
      || nested(resource, 'amount', 'currency')
      || 'CNY'
    if (!openId
      || !merchantOrderNo
      || !providerTransactionId
      || !Number.isInteger(amountCents)
      || amountCents < 1
      || currency !== 'CNY') {
      throw new Error('PAYMENT_CALLBACK_INVALID')
    }
    await options.callLedger('applyPaymentCallback', {
      orderId: attach.orderId,
      identityKey: options.identityKey(options.appId, openId, options.pepper),
      merchantOrderNo,
      providerTransactionId,
      amountCents,
      currency,
    })
    return { kind: 'payment' }
  }
}

function callbackResource(event) {
  return event?.resource && typeof event.resource === 'object' ? event.resource : event
}

function parseAttach(value) {
  if (typeof value !== 'string' || value.length > 512) {
    throw new Error('PAYMENT_CALLBACK_INVALID')
  }
  try {
    const parsed = JSON.parse(value)
    if (parsed?.version !== 1 || !validUuid(parsed.orderId)) {
      throw new Error('PAYMENT_CALLBACK_INVALID')
    }
    return parsed
  }
  catch {
    throw new Error('PAYMENT_CALLBACK_INVALID')
  }
}

function paymentSucceeded(resource) {
  return pick(resource, 'tradeState', 'trade_state') === 'SUCCESS'
}

function refundSucceeded(resource) {
  return pick(resource, 'refundStatus', 'refund_status') === 'SUCCESS'
}

function validUuid(value) {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

function nested(source, key, nestedKey) {
  const value = source?.[key]
  return value && typeof value === 'object' ? value[nestedKey] : undefined
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
  callbackResource,
  createCallbackHandler,
  parseAttach,
  paymentSucceeded,
  refundSucceeded,
}
