'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const { createCallbackHandler } = require('../domain/callback')

const appId = 'wx1234567890abcdef'
const orderId = '10000000-0000-4000-8000-000000000001'

describe('mip CloudPay callback', () => {
  it('converts a verified payment resource into an identity-keyed ledger fact', async () => {
    const calls = []
    const handle = createCallbackHandler({
      appId,
      pepper: '0123456789abcdef0123456789abcdef',
      identityKey: () => 'hashed-identity-key',
      async callLedger(action, input) {
        calls.push({ action, input })
      },
    })
    await handle({
      resource: {
        subAppid: appId,
        tradeState: 'SUCCESS',
        attach: JSON.stringify({ version: 1, orderId }),
        subOpenid: 'provider-open-id',
        outTradeNo: 'MIP123',
        transactionId: 'provider-transaction',
        totalFee: 79900,
        feeType: 'CNY',
      },
    })
    assert.equal(calls[0].action, 'applyPaymentCallback')
    assert.equal(calls[0].input.identityKey, 'hashed-identity-key')
    assert.equal(JSON.stringify(calls[0].input).includes('provider-open-id'), false)
    assert.equal(Object.hasOwn(calls[0].input, 'openId'), false)
  })

  it('routes a successful refund by merchant references without requiring OpenID', async () => {
    const calls = []
    const handle = createCallbackHandler({
      appId,
      identityKey: () => 'not-used',
      async callLedger(action, input) {
        calls.push({ action, input })
      },
    })
    await handle({
      subAppid: appId,
      refundStatus: 'SUCCESS',
      outTradeNo: 'MIP123',
      outRefundNo: 'MIPR123',
      refundId: 'provider-refund',
      refundFee: 79900,
    })
    assert.deepEqual(calls[0], {
      action: 'applyRefundCallback',
      input: {
        merchantOrderNo: 'MIP123',
        merchantRefundNo: 'MIPR123',
        providerRefundId: 'provider-refund',
        amountCents: 79900,
      },
    })
  })

  it('rejects callbacks for another AppID before touching the ledger', async () => {
    let called = false
    const handle = createCallbackHandler({
      appId,
      identityKey: () => 'identity',
      callLedger: async () => { called = true },
    })
    await assert.rejects(() => handle({ subAppid: 'wx0000000000000000' }), /CALLBACK_APP_MISMATCH/)
    assert.equal(called, false)
  })

  it('does not treat transport SUCCESS or a non-final trade state as payment success', async () => {
    for (const tradeState of [undefined, 'PROCESSING']) {
      let called = false
      const handle = createCallbackHandler({
        appId,
        identityKey: () => 'identity',
        callLedger: async () => { called = true },
      })
      await assert.rejects(() => handle({
        subAppid: appId,
        returnCode: 'SUCCESS',
        resultCode: 'SUCCESS',
        ...(tradeState ? { tradeState } : {}),
        attach: JSON.stringify({ version: 1, orderId }),
        subOpenid: 'provider-open-id',
        outTradeNo: 'MIP123',
        transactionId: 'provider-transaction',
        totalFee: 79900,
        feeType: 'CNY',
      }), /PAYMENT_CALLBACK_NOT_SUCCESSFUL/)
      assert.equal(called, false)
    }
  })

  it('accepts only explicit refundStatus SUCCESS as a refund success fact', async () => {
    for (const refundStatus of [undefined, 'PROCESSING', 'CHANGE', 'REFUNDCLOSE']) {
      let called = false
      const handle = createCallbackHandler({
        appId,
        identityKey: () => 'identity',
        callLedger: async () => { called = true },
      })
      await assert.rejects(() => handle({
        subAppid: appId,
        returnCode: 'SUCCESS',
        resultCode: 'SUCCESS',
        ...(refundStatus ? { refundStatus } : {}),
        outTradeNo: 'MIP123',
        outRefundNo: 'MIPR123',
        refundId: 'provider-refund',
        refundFee: 79900,
      }), /REFUND_CALLBACK_NOT_SUCCESSFUL/)
      assert.equal(called, false)
    }
  })
})
