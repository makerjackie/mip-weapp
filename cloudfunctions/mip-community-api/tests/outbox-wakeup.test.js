'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const { verifyInternalEvent } = require('../../mip-outbox-worker/lib/internal-auth')
const { createOutboxWakeup } = require('../lib/outbox-wakeup')

const secret = 'outbox-wakeup-secret-at-least-thirty-two-bytes'
const now = 1_780_000_000_000

describe('community outbox wakeup', () => {
  it('signs and invokes one bounded worker drain for selected mutations', async () => {
    const calls = []
    const wakeup = createOutboxWakeup({
      cloud: {
        async callFunction(input) {
          calls.push(input)
          return { result: { ok: true, data: { processed: 0 } } }
        },
      },
      functionName: 'mip-outbox-worker',
      now: () => now,
      secret,
      sourceFunctionName: 'mip-community-api',
    })
    const mutationActions = new Set(['saveEventComment'])

    assert.deepEqual(await wakeup.afterSuccessfulMutation({
      action: 'listEventComments',
      appId: 'wx-app',
      mutationActions,
    }), { status: 'SKIPPED' })
    assert.equal(calls.length, 0)

    assert.deepEqual(await wakeup.afterSuccessfulMutation({
      action: 'saveEventComment',
      appId: 'wx-app',
      mutationActions,
    }), { status: 'INVOKED' })
    assert.equal(calls.length, 1)
    assert.equal(calls[0].name, 'mip-outbox-worker')
    const verified = verifyInternalEvent(calls[0].data, {
      allowedAppIds: new Set(['wx-app']),
      now,
      secret,
    })
    assert.equal(verified.action, 'runBatch')
    assert.equal(verified.appId, 'wx-app')
    assert.equal(verified.drain, true)
    assert.equal(verified.limit, 10)
    assert.equal(verified.maxBatches, 100)
    assert.equal(verified.timestamp, now)
  })

  it('fails open when unconfigured or when the worker rejects the request', async () => {
    const warnings = []
    const missing = createOutboxWakeup({
      cloud: { callFunction: async () => { throw new Error('must not run') } },
      secret: '',
    })
    assert.deepEqual(await missing.afterSuccessfulMutation({
      action: 'saveEventComment',
      appId: 'wx-app',
      mutationActions: new Set(['saveEventComment']),
    }), { status: 'SKIPPED' })

    const failing = createOutboxWakeup({
      cloud: {
        async callFunction() {
          return { result: { ok: false, error: { code: 'CONFLICT' } } }
        },
      },
      logger: { warn: (...args) => warnings.push(args) },
      secret,
    })
    assert.deepEqual(await failing.afterSuccessfulMutation({
      action: 'saveEventComment',
      appId: 'wx-app',
      mutationActions: new Set(['saveEventComment']),
    }), { status: 'FAILED' })
    assert.deepEqual(warnings[0][1], {
      event: 'outbox_wakeup_failed',
      sourceAction: 'saveEventComment',
      code: 'CONFLICT',
    })
    assert.doesNotMatch(JSON.stringify(warnings), new RegExp(secret))
  })
})
