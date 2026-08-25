'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const { verifyInternalEvent: verifyGrowth } = require('../../mip-growth-api/lib/internal-auth')
const { verifyInternalEvent: verifyNotification } = require('../../mip-notification-worker/lib/internal-auth')
const { createInternalClients } = require('../lib/internal-clients')

const notificationSecret = 'notification-secret-with-at-least-thirty-two-bytes'
const growthSecret = 'growth-secret-with-at-least-thirty-two-bytes'

describe('outbox internal clients', () => {
  it('proves the real chained HMAC boundary without writing downstream facts', async () => {
    const now = 1_780_000_000_000
    const clients = createInternalClients({
      cloud: {
        async callFunction(input) {
          const received = {
            ...input.data,
            frameworkContext: { requestId: 'framework-injected' },
            userInfo: { appId: 'framework-injected', openId: 'framework-injected' },
          }
          if (input.name === 'mip-notification-worker') {
            verifyNotification(received, {
              secret: notificationSecret,
              allowedAppIds: new Set(['wx-app']),
              now,
            })
          }
          else {
            verifyGrowth(received, {
              secret: growthSecret,
              allowedAppIds: new Set(['wx-app']),
              now,
            })
          }
          return { result: { ok: false, error: { code: 'VALIDATION_FAILED' } } }
        },
      },
      notificationFunctionName: 'mip-notification-worker',
      notificationSecret,
      growthFunctionName: 'mip-growth-api',
      growthSecret,
      now: () => now,
    })

    assert.deepEqual(await clients.probeDependencies('wx-app'), {
      growthAuthenticated: true,
      notificationAuthenticated: true,
    })
  })

  it('uses each target function HMAC contract and propagates only successful envelopes', async () => {
    const calls = []
    const now = 1_780_000_000_000
    const clients = createInternalClients({
      cloud: {
        async callFunction(input) {
          calls.push(input)
          return { result: { ok: true, data: { accepted: true } } }
        },
      },
      notificationFunctionName: 'mip-notification-worker',
      notificationSecret,
      growthFunctionName: 'mip-growth-api',
      growthSecret,
      now: () => now,
    })
    const message = {
      recipientUserId: '10000000-0000-4000-8000-000000000001',
      messageType: 'EVENT',
      title: '活动签到成功',
      body: '到场状态已记录。',
      dedupeKey: 'outbox:one',
    }
    await clients.publishMessage('wx-app', message)
    await clients.runNotificationBatch('wx-app', 20)
    await clients.recordConfirmedEvent('wx-app', {
      userId: message.recipientUserId,
      sourceEventType: 'event.checked_in',
      sourceEventId: '90000000-0000-4000-8000-000000000001',
    })

    assert.equal(calls[0].name, 'mip-notification-worker')
    assert.deepEqual(verifyNotification(calls[0].data, {
      secret: notificationSecret,
      allowedAppIds: new Set(['wx-app']),
      now,
    }).message, message)
    assert.equal(calls[1].name, 'mip-notification-worker')
    assert.equal(calls[1].data.action, 'runDeliveryBatch')
    assert.equal(calls[1].data.drain, true)
    assert.equal(calls[1].data.maxBatches, 5)
    assert.equal(calls[2].name, 'mip-growth-api')
    assert.equal(verifyGrowth(calls[2].data, {
      secret: growthSecret,
      allowedAppIds: new Set(['wx-app']),
      now,
    }).sourceEventType, 'event.checked_in')
  })

  it('does not treat a failed target envelope as delivery success', async () => {
    const clients = createInternalClients({
      cloud: { callFunction: async () => ({ result: { ok: false, error: { code: 'CONFLICT' } } }) },
      notificationFunctionName: 'mip-notification-worker',
      notificationSecret,
      growthFunctionName: 'mip-growth-api',
      growthSecret,
    })
    await assert.rejects(() => clients.publishMessage('wx-app', {}), /CONFLICT/)
  })

  it('signs only the immutable transition reference for check-in growth', async () => {
    const calls = []
    const now = 1_780_000_000_000
    const clients = createInternalClients({
      cloud: {
        async callFunction(input) {
          calls.push(input)
          return { result: { ok: true, data: {} } }
        },
      },
      notificationFunctionName: 'mip-notification-worker',
      notificationSecret,
      growthFunctionName: 'mip-growth-api',
      growthSecret,
      now: () => now,
    })
    const transitionId = '90000000-0000-4000-8000-000000000002'
    await clients.recordConfirmedEvent('wx-app', {
      action: 'applyCheckInTransition',
      transitionId,
      userId: 'attacker-controlled',
    })
    assert.deepEqual(verifyGrowth(calls[0].data, {
      secret: growthSecret,
      allowedAppIds: new Set(['wx-app']),
      now,
    }), { appId: 'wx-app', transitionId })
    assert.equal('userId' in calls[0].data, false)
  })

  it('signs the fixed game coin action without forwarding an amount', async () => {
    const calls = []
    const now = 1_780_000_000_000
    const clients = createInternalClients({
      cloud: { async callFunction(input) { calls.push(input); return { result: { ok: true, data: {} } } } },
      notificationFunctionName: 'mip-notification-worker',
      notificationSecret,
      growthFunctionName: 'mip-growth-api',
      growthSecret,
      now: () => now,
    })
    await clients.recordConfirmedEvent('wx-app', {
      action: 'grantGameCoins',
      userId: '10000000-0000-4000-8000-000000000001',
      sourceEventType: 'game.match_won',
      sourceEventId: '90000000-0000-4000-8000-000000000003',
      amount: 999999,
    })
    const verified = verifyGrowth(calls[0].data, {
      secret: growthSecret,
      allowedAppIds: new Set(['wx-app']),
      now,
    })
    assert.equal(verified.action, 'grantGameCoins')
    assert.equal('amount' in calls[0].data, false)
  })
})
