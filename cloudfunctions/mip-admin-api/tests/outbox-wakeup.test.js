'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const { verifyInternalEvent } = require('../../mip-outbox-worker/lib/internal-auth')
const { createOutboxWakeup } = require('../lib/outbox-wakeup')

const secret = 'outbox-secret-that-is-at-least-thirty-two-bytes'

describe('admin outbox wakeup', () => {
  it('matches the worker HMAC contract after CloudBase adds transport metadata', async () => {
    const now = 1_780_000_000_000
    const client = createOutboxWakeup({
      cloud: {
        async callFunction(input) {
          assert.equal(input.name, 'mip-outbox-worker')
          const verified = verifyInternalEvent({
            ...input.data,
            frameworkContext: { requestId: 'framework-injected' },
            tcbContext: {},
            userInfo: { appId: 'framework-injected', openId: 'framework-injected' },
          }, {
            secret,
            allowedAppIds: new Set(['wx-app']),
            now,
          })
          assert.deepEqual(verified, {
            action: 'runBatch',
            appId: 'wx-app',
            drain: true,
            limit: 10,
            maxBatches: 100,
            timestamp: now,
          })
          return { result: { ok: true, data: { processed: 1 } } }
        },
      },
      functionName: 'mip-outbox-worker',
      sourceFunctionName: 'mip-admin-api',
      secret,
      now: () => now,
    })

    assert.deepEqual(await client.afterSuccessfulMutation({
      appId: 'wx-app',
      action: 'mip.admin.memberships.grant',
      mutationActions: new Set(['mip.admin.memberships.grant']),
    }), { status: 'INVOKED' })
  })
})
