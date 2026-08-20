'use strict'

function pick(source, ...keys) {
  for (const key of keys) {
    if (source?.[key] !== undefined && source[key] !== null && source[key] !== '') {
      return source[key]
    }
  }
  return undefined
}

function callbackResource(event) {
  return event?.resource && typeof event.resource === 'object' ? event.resource : event
}

function nested(source, key, nestedKey) {
  const value = source?.[key]
  return value && typeof value === 'object' ? value[nestedKey] : undefined
}

function validUuid(value) {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

function parseAttach(value) {
  if (typeof value !== 'string' || value.length > 512) throw new Error('PAYMENT_CALLBACK_INVALID')
  try {
    const parsed = JSON.parse(value)
    if (parsed?.version !== 1 || !validUuid(parsed.orderId)) throw new Error('PAYMENT_CALLBACK_INVALID')
    return parsed
  }
  catch {
    throw new Error('PAYMENT_CALLBACK_INVALID')
  }
}

function paymentSucceeded(resource) {
  const returnCode = pick(resource, 'returnCode', 'return_code')
  const resultCode = pick(resource, 'resultCode', 'result_code')
  const tradeState = pick(resource, 'tradeState', 'trade_state')
  return tradeState === 'SUCCESS' || (returnCode === 'SUCCESS' && resultCode === 'SUCCESS')
}

function refundSucceeded(resource) {
  const returnCode = pick(resource, 'returnCode', 'return_code')
  const resultCode = pick(resource, 'resultCode', 'result_code')
  const refundStatus = pick(resource, 'refundStatus', 'refund_status')
  return refundStatus === 'SUCCESS' || (returnCode === 'SUCCESS' && resultCode === 'SUCCESS')
}

function createCallbackHandler({ callLedger, appId }) {
  return async function handle(event) {
    const resource = callbackResource(event)
    const callbackAppId = pick(resource, 'subAppid', 'sub_appid', 'appid')
    if (callbackAppId && appId && callbackAppId !== appId) {
      throw new Error('CALLBACK_APP_MISMATCH')
    }
    const outRefundNo = pick(resource, 'outRefundNo', 'out_refund_no')
    if (outRefundNo) {
      if (!refundSucceeded(resource)) throw new Error('REFUND_CALLBACK_NOT_SUCCESSFUL')
      const outTradeNo = pick(resource, 'outTradeNo', 'out_trade_no')
      const refundId = pick(resource, 'refundId', 'refund_id')
      const refundAmountCents = Number(pick(resource, 'refundFee', 'refund_fee'))
      if (!outTradeNo || !refundId || !Number.isInteger(refundAmountCents) || refundAmountCents <= 0) {
        throw new Error('REFUND_CALLBACK_INVALID')
      }
      await callLedger('applyRefundCallback', {
        outTradeNo,
        outRefundNo,
        refundId,
        refundAmountCents,
      })
      return { kind: 'refund' }
    }

    if (!paymentSucceeded(resource)) throw new Error('PAYMENT_CALLBACK_NOT_SUCCESSFUL')
    const attach = parseAttach(pick(resource, 'attach'))
    const userId = pick(resource, 'subOpenid', 'sub_openid', 'openid')
      || nested(resource, 'payer', 'openid')
    const outTradeNo = pick(resource, 'outTradeNo', 'out_trade_no')
    const transactionId = pick(resource, 'transactionId', 'transaction_id')
    const amountCents = Number(
      pick(resource, 'totalFee', 'total_fee')
      ?? nested(resource, 'amount', 'total'),
    )
    const currency = pick(resource, 'feeType', 'fee_type')
      || nested(resource, 'amount', 'currency')
      || 'CNY'
    if (!userId || !outTradeNo || !transactionId || !Number.isInteger(amountCents) || amountCents <= 0 || currency !== 'CNY') {
      throw new Error('PAYMENT_CALLBACK_INVALID')
    }
    await callLedger('applyPaymentCallback', {
      orderId: attach.orderId,
      userId,
      outTradeNo,
      transactionId,
      amountCents,
      currency,
    })
    return { kind: 'payment' }
  }
}

module.exports = {
  callbackResource,
  createCallbackHandler,
  parseAttach,
  paymentSucceeded,
  refundSucceeded,
}
