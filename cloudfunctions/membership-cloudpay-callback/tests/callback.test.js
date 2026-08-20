'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const { createCallbackHandler, parseAttach } = require('../domain/callback')

describe('CloudPay callback', () => {
  it('persists a verified payment before acknowledging', async () => {
    let call
    const handler = createCallbackHandler({
      callLedger: async (action, value) => { call = [action, value] },
    })
    const result = await handler({
      resource: {
        returnCode: 'SUCCESS',
        resultCode: 'SUCCESS',
        attach: JSON.stringify({ version: 1, orderId: 'e0b268a3-d2e5-4e1c-9db7-2878f0fd7864' }),
        subOpenid: 'trusted-user',
        outTradeNo: 'M123',
        transactionId: 'WX123',
        totalFee: 10,
        feeType: 'CNY',
      },
    })
    assert.deepEqual(result, { kind: 'payment' })
    assert.equal(call[0], 'applyPaymentCallback')
    assert.equal(call[1].orderId, 'e0b268a3-d2e5-4e1c-9db7-2878f0fd7864')
    assert.equal(call[1].amountCents, 10)
  })

  it('persists a successful refund callback', async () => {
    let call
    const handler = createCallbackHandler({
      callLedger: async (action, value) => { call = [action, value] },
    })
    const result = await handler({
      outTradeNo: 'M123',
      outRefundNo: 'R123',
      refundId: 'WX-R123',
      refundFee: 10,
      refundStatus: 'SUCCESS',
    })
    assert.deepEqual(result, { kind: 'refund' })
    assert.equal(call[0], 'applyRefundCallback')
    assert.equal(call[1].refundAmountCents, 10)
  })

  it('accepts the current nested WeChat Pay notification resource', async () => {
    let call
    const handler = createCallbackHandler({
      appId: 'wx1234567890abcdef',
      callLedger: async (action, value) => { call = [action, value] },
    })
    await handler({
      event_type: 'TRANSACTION.SUCCESS',
      resource: {
        appid: 'wx1234567890abcdef',
        attach: JSON.stringify({ version: 1, orderId: 'e0b268a3-d2e5-4e1c-9db7-2878f0fd7864' }),
        trade_state: 'SUCCESS',
        out_trade_no: 'M123',
        transaction_id: 'WX123',
        payer: { openid: 'trusted-user' },
        amount: { total: 10, currency: 'CNY' },
      },
    })
    assert.equal(call[0], 'applyPaymentCallback')
    assert.equal(call[1].userId, 'trusted-user')
    assert.equal(call[1].amountCents, 10)
  })

  it('rejects an untrusted or malformed callback', async () => {
    const handler = createCallbackHandler({
      appId: 'wx1234567890abcdef',
      callLedger: async () => assert.fail('ledger must not be called'),
    })
    await assert.rejects(() => handler({ returnCode: 'FAIL' }), /PAYMENT_CALLBACK_NOT_SUCCESSFUL/)
    await assert.rejects(() => handler({ subAppid: 'wxabcdef1234567890' }), /CALLBACK_APP_MISMATCH/)
    assert.throws(() => parseAttach('{"orderId":"client"}'), /PAYMENT_CALLBACK_INVALID/)
  })
})
