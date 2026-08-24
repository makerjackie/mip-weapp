'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const { createRefundDispatchService } = require('../domain/refund-dispatch')

const appId = 'wx1234567890abcdef'
const refundId = '20000000-0000-4000-8000-000000000001'

function config(overrides = {}) {
  return {
    envId: 'environment',
    appId,
    merchantId: '1234567890',
    callbackFunction: 'mip-cloudpay-callback',
    paymentMode: 'test',
    ...overrides,
  }
}

function refund(overrides = {}) {
  return {
    id: refundId,
    orderId: '10000000-0000-4000-8000-000000000001',
    merchantOrderNo: 'MIP123',
    merchantRefundNo: 'MIPR123',
    amountCents: 19900,
    totalCents: 79900,
    currency: 'CNY',
    reason: '用户申请退款',
    status: 'PENDING',
    ...overrides,
  }
}

describe('refund provider worker', () => {
  it('fails closed when payment configuration is incomplete', async () => {
    let called = false
    const service = createRefundDispatchService({
      config: config({ merchantId: '' }),
      callLedger: async () => { called = true },
      cloudPay: { refund: async () => { called = true } },
      nonce: () => 'nonce',
    })
    assert.equal(service.configReady, false)
    await assert.rejects(() => service.dispatchRefund(appId, { refundId }), /PAYMENT_CONFIG_REQUIRED/)
    assert.equal(called, false)
  })

  it('submits only the ledger-authoritative amount and merchant references', async () => {
    const ledgerCalls = []
    const providerCalls = []
    const service = createRefundDispatchService({
      config: config(),
      nonce: () => 'nonce',
      async callLedger(action, requestedAppId, input) {
        ledgerCalls.push({ action, appId: requestedAppId, input })
        if (action === 'getRefundRequestForProvider') return refund()
        return { status: 'PROVIDER_CREATED' }
      },
      cloudPay: {
        async refund(input) {
          providerCalls.push(input)
          return { returnCode: 'SUCCESS', resultCode: 'SUCCESS', refundId: 'provider-refund' }
        },
      },
    })
    const result = await service.dispatchRefund(appId, { refundId, amountCents: 1 })
    assert.deepEqual(result, { status: 'PROVIDER_CREATED', operation: 'SUBMITTED' })
    assert.equal(providerCalls[0].totalFee, 79900)
    assert.equal(providerCalls[0].refundFee, 19900)
    assert.equal(providerCalls[0].outTradeNo, 'MIP123')
    assert.equal(providerCalls[0].outRefundNo, 'MIPR123')
    assert.deepEqual(ledgerCalls[0].input, { refundId })
  })

  it('reconciles an existing provider refund through the ledger callback path', async () => {
    const ledgerCalls = []
    const service = createRefundDispatchService({
      config: config(),
      nonce: () => 'nonce',
      async callLedger(action, requestedAppId, input) {
        ledgerCalls.push({ action, appId: requestedAppId, input })
        if (action === 'getRefundRequestForProvider') {
          return refund({ status: 'PROVIDER_CREATED', providerRefundId: 'provider-refund' })
        }
        return { status: 'SUCCEEDED' }
      },
      cloudPay: {
        async queryRefund() {
          return {
            returnCode: 'SUCCESS',
            resultCode: 'SUCCESS',
            outRefundNoList: ['MIPR123'],
            refundStatusList: ['SUCCESS'],
            refundIdList: ['provider-refund'],
            refundFeeList: [19900],
          }
        },
      },
    })
    const result = await service.dispatchRefund(appId, { refundId })
    assert.deepEqual(result, { status: 'SUCCEEDED', operation: 'RECONCILED' })
    const apply = ledgerCalls.find(call => call.action === 'applyRefundCallback')
    assert.equal(apply.input.amountCents, 19900)
    assert.equal(apply.input.merchantOrderNo, 'MIP123')
  })

  it('recovers durable active refunds in a bounded batch and continues after one failure', async () => {
    const errors = []
    const ids = [
      refundId,
      '20000000-0000-4000-8000-000000000002',
    ]
    const service = createRefundDispatchService({
      config: config(),
      nonce: () => 'nonce',
      onError: error => errors.push(error.message),
      async callLedger(action, requestedAppId, input) {
        if (action === 'listPendingRefunds') return { refundIds: ids }
        if (action === 'getRefundRequestForProvider') {
          if (input.refundId === ids[1]) throw new Error('TEMPORARY_FAILURE')
          return refund({ id: input.refundId })
        }
        return { status: 'PROVIDER_CREATED' }
      },
      cloudPay: {
        async refund() {
          return { returnCode: 'SUCCESS', resultCode: 'SUCCESS', refundId: 'provider-refund' }
        },
      },
    })
    const result = await service.runBatch(appId, { limit: 2 })
    assert.deepEqual(result, { scanned: 2, submitted: 1, reconciled: 0, pending: 0, failed: 1 })
    assert.deepEqual(errors, ['TEMPORARY_FAILURE'])
  })
})
