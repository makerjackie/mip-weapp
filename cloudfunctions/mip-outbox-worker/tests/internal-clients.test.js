'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const { createInternalClients } = require('../lib/internal-clients')
const { verifyInternalEvent: verifyGrowth } = require('../../mip-growth-api/lib/internal-auth')
const { verifyInternalEvent: verifyNotification } = require('../../mip-notification-worker/lib/internal-auth')

const notificationSecret = 'notification-secret-with-at-least-thirty-two-bytes'
const growthSecret = 'growth-secret-with-at-least-thirty-two-bytes'

describe('outbox internal clients', () => {
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
    assert.equal(calls[1].name, 'mip-growth-api')
    assert.equal(verifyGrowth(calls[1].data, {
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
      cloud: { callFunction: async (input) => { calls.push(input); return { result: { ok: true, data: {} } } } },
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
})
