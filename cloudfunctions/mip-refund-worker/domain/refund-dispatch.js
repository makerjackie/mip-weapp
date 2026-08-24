'use strict'

function createRefundDispatchService(options) {
  const config = options.config
  const configReady = Boolean(
    config.envId
    && /^wx[0-9a-f]{16}$/i.test(config.appId)
    && /^\d{6,32}$/.test(config.merchantId)
    && config.callbackFunction
    && ['test', 'live'].includes(config.paymentMode),
  )

  function assertReady() {
    if (!configReady) throw new Error('PAYMENT_CONFIG_REQUIRED')
  }

  async function dispatchRefund(appId, value) {
    assertReady()
    if (appId !== config.appId) throw new Error('FORBIDDEN')
    const refundId = uuid(value?.refundId)
    const refund = await options.callLedger('getRefundRequestForProvider', appId, { refundId })
    assertRefund(refund)
    if (refund.status === 'PENDING') {
      return submitProviderRefund(appId, refund)
    }
    return reconcileProviderRefund(appId, refund)
  }

  async function submitProviderRefund(appId, refund) {
    if (refund.manualReview) throw new Error('REFUND_MANUAL_REVIEW')
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
    if (!successful(result)) throw new Error('REFUND_UNAVAILABLE')
    await options.callLedger('markRefundCreated', appId, {
      refundId: refund.id,
      merchantRefundNo: refund.merchantRefundNo,
      providerRefundId: pick(result, 'refundId', 'refund_id'),
    })
    return { status: 'PROVIDER_CREATED', operation: 'SUBMITTED' }
  }

  async function reconcileProviderRefund(appId, refund) {
    const result = await options.cloudPay.queryRefund({
      subMchId: config.merchantId,
      nonceStr: options.nonce(),
      outRefundNo: refund.merchantRefundNo,
    })
    if (!successful(result)) throw new Error('REFUND_QUERY_UNAVAILABLE')
    const record = refundRecord(result, refund.merchantRefundNo)
    if (!record) {
      return { status: refund.manualReview ? 'MANUAL_REVIEW' : refund.status, operation: 'PENDING' }
    }
    if (record.status === 'SUCCESS') {
      if (!record.providerRefundId || !Number.isInteger(record.amountCents) || record.amountCents < 1) {
        throw new Error('REFUND_QUERY_MISMATCH')
      }
      await options.callLedger('applyRefundCallback', appId, {
        refundId: refund.id,
        merchantOrderNo: refund.merchantOrderNo,
        merchantRefundNo: refund.merchantRefundNo,
        providerRefundId: String(record.providerRefundId),
        amountCents: record.amountCents,
      })
      return { status: 'SUCCEEDED', operation: 'RECONCILED' }
    }
    if (record.status === 'CHANGE') {
      await options.callLedger('markRefundManualReview', appId, {
        refundId: refund.id,
        merchantRefundNo: refund.merchantRefundNo,
        reasonCode: 'CHANGE',
      })
      return { status: 'MANUAL_REVIEW', operation: 'RECONCILED' }
    }
    if (record.status === 'REFUNDCLOSE') {
      await options.callLedger('markRefundFailed', appId, {
        refundId: refund.id,
        merchantRefundNo: refund.merchantRefundNo,
        reasonCode: 'REFUNDCLOSE',
      })
      return { status: 'FAILED', operation: 'RECONCILED' }
    }
    return { status: refund.manualReview ? 'MANUAL_REVIEW' : refund.status, operation: 'PENDING' }
  }

  async function runBatch(appId, value = {}) {
    assertReady()
    if (appId !== config.appId) throw new Error('FORBIDDEN')
    const limit = batchLimit(value.limit)
    const pending = await options.callLedger('listPendingRefunds', appId, { limit })
    const refundIds = Array.isArray(pending?.refundIds) ? pending.refundIds.slice(0, limit) : []
    const summary = { scanned: refundIds.length, submitted: 0, reconciled: 0, pending: 0, failed: 0 }
    for (const refundId of refundIds) {
      try {
        const result = await dispatchRefund(appId, { refundId })
        if (result.operation === 'SUBMITTED') summary.submitted += 1
        else if (result.operation === 'RECONCILED') summary.reconciled += 1
        else summary.pending += 1
      }
      catch (error) {
        summary.failed += 1
        options.onError?.(error)
      }
    }
    return summary
  }

  async function dispatchRefunds(appId, value = {}) {
    assertReady()
    if (appId !== config.appId) throw new Error('FORBIDDEN')
    if (!Array.isArray(value.refundIds)
      || value.refundIds.length < 1
      || value.refundIds.length > 10) {
      throw new Error('INVALID_REFUND_BATCH')
    }
    const refundIds = [...new Set(value.refundIds.map(uuid))]
    if (refundIds.length !== value.refundIds.length) throw new Error('INVALID_REFUND_BATCH')
    return dispatchMany(appId, refundIds)
  }

  async function dispatchMany(appId, refundIds) {
    const summary = { scanned: refundIds.length, submitted: 0, reconciled: 0, pending: 0, failed: 0 }
    for (const refundId of refundIds) {
      try {
        const result = await dispatchRefund(appId, { refundId })
        if (result.operation === 'SUBMITTED') summary.submitted += 1
        else if (result.operation === 'RECONCILED') summary.reconciled += 1
        else summary.pending += 1
      }
      catch (error) {
        summary.failed += 1
        options.onError?.(error)
      }
    }
    return summary
  }

  return { configReady, dispatchRefund, dispatchRefunds, runBatch }
}

function assertRefund(refund) {
  if (!uuidValue(refund?.id)
    || !validMerchantReference(refund?.merchantOrderNo, 32)
    || !validMerchantReference(refund?.merchantRefundNo, 64)
    || !Number.isInteger(refund?.amountCents)
    || !Number.isInteger(refund?.totalCents)
    || refund.amountCents < 1
    || refund.amountCents > refund.totalCents
    || refund.currency !== 'CNY'
    || !['PENDING', 'PROVIDER_CREATED', 'PROCESSING'].includes(refund.status)) {
    throw new Error('INVALID_REFUND_REQUEST')
  }
}

function batchLimit(value) {
  const limit = Number(value || 5)
  if (!Number.isInteger(limit) || limit < 1 || limit > 10) throw new Error('INVALID_BATCH_LIMIT')
  return limit
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

function uuid(value) {
  if (!uuidValue(value)) throw new Error('INVALID_REFUND_REQUEST')
  return value
}

function uuidValue(value) {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

function pick(source, ...keys) {
  for (const key of keys) {
    if (source?.[key] !== undefined && source[key] !== null && source[key] !== '') return source[key]
  }
  return undefined
}

module.exports = { assertRefund, batchLimit, createRefundDispatchService, refundRecord, successful }
