'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const { createPaymentService } = require('../domain/payment')

const caller = {
  appId: 'wx1234567890abcdef',
  openId: 'provider-open-id',
  identityKey: 'trusted-identity-key',
}
const orderId = '10000000-0000-4000-8000-000000000001'
const refundId = '20000000-0000-4000-8000-000000000001'

function config(overrides = {}) {
  return {
    envId: 'environment',
    appId: caller.appId,
    merchantId: '1234567890',
    callbackFunction: 'mip-cloudpay-callback',
    paymentMode: 'test',
    ...overrides,
  }
}

describe('mip CloudPay adapter', () => {
  it('fails closed before calling dependencies when configuration is incomplete', async () => {
    let called = false
    const service = createPaymentService({
      config: config({ merchantId: '' }),
      callLedger: async () => { called = true },
      cloudPay: { unifiedOrder: async () => { called = true } },
      nonce: () => 'nonce',
    })
    assert.equal(service.configReady, false)
    await assert.rejects(() => service.createPayment(caller, { orderId }), /PAYMENT_CONFIG_REQUIRED/)
    assert.equal(called, false)
  })

  it('uses only the ledger amount and sends the raw OpenID only to CloudPay', async () => {
    const calls = []
    const providerCalls = []
    const service = createPaymentService({
      config: config(),
      nonce: () => 'nonce',
      async callLedger(action, input) {
        calls.push({ action, input })
        if (action === 'getPayableOrder') {
          return {
            id: orderId,
            status: 'CREATED',
            description: '年度玩家',
            merchantOrderNo: 'MIP123',
            amountCents: 79900,
            currency: 'CNY',
          }
        }
        return { status: 'PAYMENT_CREATED' }
      },
      cloudPay: {
        async unifiedOrder(input) {
          providerCalls.push(input)
          return {
            payment: {
              timeStamp: '1777000000',
              nonceStr: 'provider-nonce',
              package: 'prepay_id=provider-prepay',
              signType: 'RSA',
              paySign: 'provider-signature',
            },
          }
        },
      },
    })
    await service.createPayment(caller, { orderId, amountCents: 1 })
    assert.equal(providerCalls[0].totalFee, 79900)
    assert.equal(providerCalls[0].subOpenid, caller.openId)
    assert.equal(calls[0].input.identityKey, caller.identityKey)
    assert.equal(calls[1].input.amountCents, 79900)
    assert.equal(JSON.stringify(calls).includes(caller.openId), false)
  })

  it('allows a ledger-authorized partial refund without client amount', async () => {
    const providerCalls = []
    const service = createPaymentService({
      config: config(),
      nonce: () => 'nonce',
      async callLedger(action) {
        if (action === 'getRefundRequest') {
          return {
            id: refundId,
            merchantOrderNo: 'MIP123',
            merchantRefundNo: 'MIPR123',
            amountCents: 19900,
            totalCents: 79900,
            currency: 'CNY',
            status: 'PENDING',
          }
        }
        return { status: 'PROVIDER_CREATED' }
      },
      cloudPay: {
        async refund(input) {
          providerCalls.push(input)
          return { returnCode: 'SUCCESS', resultCode: 'SUCCESS', refundId: 'provider-refund' }
        },
      },
    })
    await service.submitRefund(caller, { refundId, amountCents: 1 })
    assert.equal(providerCalls[0].totalFee, 79900)
    assert.equal(providerCalls[0].refundFee, 19900)
  })
})
