'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const { verifyInternalEvent } = require('../../mip-outbox-worker/lib/internal-auth')

const implementations = [
  ['identity', require('../lib/outbox-wakeup')],
  ['events', require('../../mip-events-api/lib/outbox-wakeup')],
  ['opportunities', require('../../mip-opportunities-api/lib/outbox-wakeup')],
  ['commerce', require('../../mip-commerce-api/lib/outbox-wakeup')],
  ['payment-ledger', require('../../mip-payment-ledger/lib/outbox-wakeup')],
  ['tasks', require('../../mip-tasks-api/lib/outbox-wakeup')],
  ['admin', require('../../mip-admin-api/lib/outbox-wakeup')],
]

const secret = 'outbox-wakeup-secret-at-least-thirty-two-bytes'
const now = 1_780_000_000_000

describe('event-driven outbox wakeup', () => {
  for (const [name, implementation] of implementations) {
    it(`${name} signs a bounded runBatch request only after a selected mutation`, async () => {
      const calls = []
      const wakeup = implementation.createOutboxWakeup({
        cloud: {
          async callFunction(input) {
            calls.push(input)
            return { result: { ok: true, data: { processed: 0 } } }
          },
        },
        functionName: 'mip-outbox-worker',
        secret,
        sourceFunctionName: `mip-${name}-api`,
        now: () => now,
      })
      const mutationActions = new Set(['save'])

      assert.deepEqual(await wakeup.afterSuccessfulMutation({
        appId: 'wx-app',
        action: 'list',
        mutationActions,
      }), { status: 'SKIPPED' })
      assert.equal(calls.length, 0)

      assert.deepEqual(await wakeup.afterSuccessfulMutation({
        appId: 'wx-app',
        action: 'save',
        mutationActions,
      }), { status: 'INVOKED' })
      assert.equal(calls.length, 1)
      assert.equal(calls[0].name, 'mip-outbox-worker')
      const verified = verifyInternalEvent(calls[0].data, {
        secret,
        allowedAppIds: new Set(['wx-app']),
        now,
      })
      assert.equal(verified.action, 'runBatch')
      assert.equal(verified.appId, 'wx-app')
      assert.equal(verified.drain, true)
      assert.equal(verified.limit, 10)
      assert.equal(verified.maxBatches, 100)
      assert.equal(verified.timestamp, now)
    })
  }

  it('fails open without configuration and keeps invocation failures out of the business result', async () => {
    const calls = []
    const warnings = []
    const missing = implementations[0][1].createOutboxWakeup({
      cloud: { callFunction: async input => calls.push(input) },
      secret: '',
    })
    assert.deepEqual(await missing.afterSuccessfulMutation({
      appId: 'wx-app',
      action: 'save',
      mutationActions: new Set(['save']),
    }), { status: 'SKIPPED' })

    const failing = implementations[0][1].createOutboxWakeup({
      cloud: { callFunction: async () => ({ result: { ok: false, error: { code: 'CONFLICT' } } }) },
      secret,
      logger: { warn: (...args) => warnings.push(args) },
    })
    assert.deepEqual(await failing.afterSuccessfulMutation({
      appId: 'wx-app',
      action: 'save',
      mutationActions: new Set(['save']),
    }), { status: 'FAILED' })
    assert.equal(calls.length, 0)
    assert.deepEqual(warnings[0][1], {
      event: 'outbox_wakeup_failed',
      sourceAction: 'save',
      code: 'CONFLICT',
    })
    assert.doesNotMatch(JSON.stringify(warnings), new RegExp(secret))
  })

  it('uses only a complete allowlisted CloudBase identity and rejects recursive configuration', async () => {
    const { createOutboxWakeup, trustedContextAppId } = implementations[0][1]
    const allowed = new Set(['wx-direct', 'wx-delegated'])
    assert.equal(trustedContextAppId({ APPID: 'wx-direct', OPENID: 'openid' }, allowed), 'wx-direct')
    assert.equal(trustedContextAppId({
      APPID: 'wx-direct',
      OPENID: 'openid',
      FROM_APPID: 'wx-delegated',
      FROM_OPENID: 'from-openid',
    }, allowed), 'wx-delegated')
    assert.equal(trustedContextAppId({ FROM_APPID: 'wx-delegated' }, allowed), '')
    assert.equal(trustedContextAppId({ APPID: 'wx-unlisted', OPENID: 'openid' }, allowed), '')

    let invoked = false
    const recursive = createOutboxWakeup({
      cloud: { callFunction: async () => { invoked = true } },
      functionName: 'mip-outbox-worker',
      sourceFunctionName: 'mip-outbox-worker',
      secret,
    })
    assert.deepEqual(await recursive.afterSuccessfulMutation({
      appId: 'wx-direct',
      action: 'save',
      mutationActions: new Set(['save']),
    }), { status: 'SKIPPED' })
    assert.equal(invoked, false)
  })
})
