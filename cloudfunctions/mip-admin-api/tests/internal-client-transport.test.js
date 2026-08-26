'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const { createMatchingClient } = require('../lib/matching-client')
const { createRefundWorkerClient } = require('../lib/refund-worker-client')
const { verifyInternalMatching } = require('../../mip-opportunities-api/lib/internal-matching')
const { verifyInternalEvent } = require('../../mip-refund-worker/lib/internal-auth')

const APP_ID = 'wx1234567890abcdef'
const MATCHING_SECRET = 'matching-internal-secret-with-32-characters'
const REFUND_SECRET = 'refund-internal-secret-with-at-least-32-chars'
const transportMetadata = {
  frameworkContext: { requestId: 'framework-injected' },
  tcbContext: {},
  userInfo: { appId: 'framework-injected', openId: 'framework-injected' },
}

describe('admin internal clients across the CloudBase transport boundary', () => {
  it('keeps the refund worker client signature valid after framework metadata injection', async () => {
    const calls = []
    const client = createRefundWorkerClient({
      cloud: {
        async callFunction(input) {
          calls.push(input)
          const verified = verifyInternalEvent({ ...input.data, ...transportMetadata }, {
            allowedAppIds: new Set([APP_ID]),
            secret: REFUND_SECRET,
            now: input.data.timestamp,
          })
          return { result: { ok: true, data: { refundId: verified.refundId } } }
        },
      },
      functionName: 'mip-refund-worker',
      secret: REFUND_SECRET,
    })
    const refundId = '20000000-0000-4000-8000-000000000001'

    await assert.doesNotReject(() => client.dispatchRefund({ appId: APP_ID, refundId }))
    assert.equal(calls.length, 1)
    assert.equal(calls[0].name, 'mip-refund-worker')
  })

  it('keeps the matching client signature valid after framework metadata injection', async () => {
    const calls = []
    const client = createMatchingClient({
      cloud: {
        async callFunction(input) {
          calls.push(input)
          const verified = verifyInternalMatching({ ...input.data, ...transportMetadata }, {
            secret: MATCHING_SECRET,
            now: () => input.data.timestamp,
          })
          return { result: { ok: true, data: { opportunityId: verified.opportunityId } } }
        },
      },
      functionName: 'mip-opportunities-api',
      secret: MATCHING_SECRET,
    })
    const opportunityId = '30000000-0000-4000-8000-000000000001'

    await assert.doesNotReject(() => client.recalculate({
      appId: APP_ID,
      actorUserId: '10000000-0000-4000-8000-000000000001',
      requesterUserId: '20000000-0000-4000-8000-000000000001',
      opportunityId,
      sourceVersion: 4,
      idempotencyKey: 'admin-recalculate-0001',
    }))
    assert.equal(calls.length, 1)
    assert.equal(calls[0].name, 'mip-opportunities-api')
  })
})
