'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const { createPaymentService, normalizePayment, paymentRecord, refundRecord } = require('../domain/payment')

const config = {
  envId: 'environment-for-test',
  appId: 'wx1234567890abcdef',
  merchantId: '1234567890',
  callbackFunction: 'membership-cloudpay-callback',
  paymentMode: 'test',
}

describe('native CloudPay adapter', () => {
  it('builds unifiedOrder only from the trusted ledger order', async () => {
    const calls = []
    const cloudPay = {
      async unifiedOrder(value) {
        calls.push(value)
        return { payment: { timeStamp: '123', nonceStr: 'wx-nonce', package: 'prepay_id=trusted', signType: 'MD5', paySign: 'signed' } }
      },
    }
    const ledgerCalls = []
    const callLedger = async (action, value) => {
      ledgerCalls.push([action, value])
      if (action === 'getPayableOrder') {
        return { id: 'e0b268a3-d2e5-4e1c-9db7-2878f0fd7864', description: '测试会员', outTradeNo: 'M123', amountCents: 10, currency: 'CNY' }
      }
      return null
    }
    const service = createPaymentService({ cloudPay, callLedger, config, nonce: () => 'server-nonce' })
    const result = await service.createPayment({
      orderId: 'e0b268a3-d2e5-4e1c-9db7-2878f0fd7864',
      userId: 'trusted-user',
      amountCents: 1,
      outTradeNo: 'CLIENT-CANNOT-SET',
    })
    assert.equal(result.payment.package, 'prepay_id=trusted')
    assert.equal(calls[0].totalFee, 10)
    assert.equal(calls[0].outTradeNo, 'M123')
    assert.equal(calls[0].subOpenid, 'trusted-user')
    assert.deepEqual(ledgerCalls.map(item => item[0]), ['getPayableOrder', 'markPaymentCreated'])
  })

  it('submits only a full trusted refund and persists accepted state', async () => {
    let refundInput
    const cloudPay = {
      async refund(value) {
        refundInput = value
        return { returnCode: 'SUCCESS', resultCode: 'SUCCESS', refundId: 'wx-refund' }
      },
    }
    const ledgerCalls = []
    const callLedger = async (action, value) => {
      ledgerCalls.push([action, value])
      if (action === 'getRefundRequest') {
        return { outTradeNo: 'M123', outRefundNo: 'R123', reason: '用户退款', amountCents: 10, totalCents: 10, currency: 'CNY' }
      }
      return null
    }
    const service = createPaymentService({ cloudPay, callLedger, config, nonce: () => 'server-nonce' })
    const result = await service.submitRefund({ refundId: '328e8379-79c3-4536-8116-c63b33e828a4', userId: 'admin' })
    assert.equal(result.status, 'REFUND_CREATED')
    assert.equal(refundInput.refundFee, 10)
    assert.equal(refundInput.totalFee, 10)
    assert.equal(refundInput.subAppid, undefined)
    assert.deepEqual(ledgerCalls.map(item => item[0]), ['getRefundRequest', 'markRefundCreated'])
  })

  it('reconciles a successful payment through an authoritative order query', async () => {
    const ledgerCalls = []
    const callLedger = async (action, value) => {
      ledgerCalls.push([action, value])
      if (action === 'getPayableOrder') {
        return { id: 'e0b268a3-d2e5-4e1c-9db7-2878f0fd7864', outTradeNo: 'M123', amountCents: 10, currency: 'CNY' }
      }
      return null
    }
    const cloudPay = {
      async queryOrder() {
        return {
          returnCode: 'SUCCESS',
          resultCode: 'SUCCESS',
          tradeState: 'SUCCESS',
          outTradeNo: 'M123',
          transactionId: 'WX123',
          subOpenid: 'trusted-user',
          totalFee: 10,
          feeType: 'CNY',
        }
      },
    }
    const service = createPaymentService({ cloudPay, callLedger, config, nonce: () => 'server-nonce' })
    assert.deepEqual(await service.syncPayment({
      orderId: 'e0b268a3-d2e5-4e1c-9db7-2878f0fd7864',
      userId: 'trusted-user',
    }), { status: 'PAID' })
    assert.deepEqual(ledgerCalls.map(item => item[0]), ['getPayableOrder', 'applyPaymentCallback'])
  })

  it('reconciles a successful refund through the ledger', async () => {
    let refundQueryInput
    const callLedger = async (action, value) => {
      if (action === 'getRefundRequest') {
        return {
          outTradeNo: 'M123',
          outRefundNo: 'R123',
          transactionId: 'WX123',
          reason: '退款',
          amountCents: 10,
          totalCents: 10,
          currency: 'CNY',
        }
      }
      assert.equal(action, 'applyRefundCallback')
      assert.equal(value.refundAmountCents, 10)
      return null
    }
    const cloudPay = {
      async queryRefund(value) {
        refundQueryInput = value
        return {
          returnCode: 'SUCCESS',
          resultCode: 'SUCCESS',
          refundCount: 1,
          outRefundNo0: 'R123',
          refundStatus0: 'SUCCESS',
          refundId0: 'WX-R123',
          refundFee0: 10,
        }
      },
    }
    const service = createPaymentService({ cloudPay, callLedger, config, nonce: () => 'server-nonce' })
    assert.deepEqual(
      await service.syncRefund({ refundId: '328e8379-79c3-4536-8116-c63b33e828a4', userId: 'admin' }),
      { status: 'REFUNDED' },
    )
    assert.equal(refundQueryInput.transactionId, undefined)
    assert.equal(refundQueryInput.offset, undefined)
    assert.equal(refundQueryInput.outTradeNo, undefined)
    assert.equal(refundQueryInput.outRefundNo, 'R123')
    assert.equal(refundQueryInput.subAppid, undefined)
  })

  it('allows only the owner to manually confirm an externally verified refund', async () => {
    const ledgerCalls = []
    const callLedger = async (action, value) => {
      ledgerCalls.push([action, value])
      if (action === 'getRefundRequest') {
        return { adminRole: 'owner' }
      }
      return null
    }
    const service = createPaymentService({ cloudPay: {}, callLedger, config, nonce: () => 'server-nonce' })
    assert.deepEqual(await service.confirmRefund({
      refundId: '328e8379-79c3-4536-8116-c63b33e828a4',
      userId: 'owner-user',
    }), { status: 'REFUNDED' })
    assert.deepEqual(ledgerCalls.map(item => item[0]), ['getRefundRequest', 'confirmRefundManually'])
    assert.equal(ledgerCalls[1][1].operatorId, 'owner-user')
  })

  it('rejects manual refund confirmation from non-owner operators', async () => {
    const callLedger = async () => ({ adminRole: 'support' })
    const service = createPaymentService({ cloudPay: {}, callLedger, config, nonce: () => 'server-nonce' })
    await assert.rejects(() => service.confirmRefund({
      refundId: '328e8379-79c3-4536-8116-c63b33e828a4',
      userId: 'support-user',
    }), /REFUND_CONFIRMATION_FORBIDDEN/)
  })

  it('accepts only complete Mini Program payment parameters', () => {
    assert.equal(normalizePayment({ timeStamp: 1, nonceStr: 'n', package: 'prepay_id=x', signType: 'RSA', paySign: 's' }).timeStamp, '1')
    assert.throws(() => normalizePayment({ package: 'client-package' }), /PAYMENT_UNAVAILABLE/)
  })

  it('finds the requested refund in a query response', () => {
    assert.deepEqual(refundRecord({ refundCount: 1, outRefundNo0: 'R1', refundStatus0: 'PROCESSING', refundId0: 'WX1', refundFee0: 10 }, 'R1'), {
      status: 'PROCESSING',
      refundId: 'WX1',
      amountCents: 10,
    })
  })

  it('reads indexed refund fields after wx-server-sdk snake-case conversion', () => {
    assert.deepEqual(refundRecord({
      refundCount: 1,
      outRefundNo_0: 'R1',
      refundStatus_0: 'SUCCESS',
      refundId_0: 'WX1',
      refundFee_0: 10,
    }, 'R1'), {
      status: 'SUCCESS',
      refundId: 'WX1',
      amountCents: 10,
    })
  })

  it('reads the refund list arrays returned by CloudPay queryRefund', () => {
    assert.deepEqual(refundRecord({
      refundCount: 2,
      outRefundNoList: ['R0', 'R1'],
      refundStatusList: ['PROCESSING', 'SUCCESS'],
      refundIdList: ['WX0', 'WX1'],
      refundFeeList: [5, 10],
    }, 'R1'), {
      status: 'SUCCESS',
      refundId: 'WX1',
      amountCents: 10,
    })
  })

  it('does not infer refund success from a matching refund number alone', () => {
    assert.deepEqual(refundRecord({
      outRefundNo: 'R1',
      refundId: 'WX1',
      refundFee: 10,
    }, 'R1'), {
      status: undefined,
      refundId: 'WX1',
      amountCents: 10,
    })
  })

  it('normalizes the current WeChat Pay callback/query resource shape', () => {
    assert.deepEqual(paymentRecord({
      resource: {
        trade_state: 'SUCCESS',
        out_trade_no: 'M123',
        transaction_id: 'WX123',
        payer: { openid: 'trusted-user' },
        amount: { total: 10, currency: 'CNY' },
      },
    }), {
      status: 'SUCCESS',
      outTradeNo: 'M123',
      transactionId: 'WX123',
      userId: 'trusted-user',
      amountCents: 10,
      currency: 'CNY',
    })
  })
})
