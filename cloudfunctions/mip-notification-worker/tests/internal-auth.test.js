'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const { signInternalEvent, verifyInternalEvent } = require('../lib/internal-auth')

const secret = 'notification-internal-secret-longer-than-thirty-two'
const now = 1_800_000_000_000

test('signature covers the complete business body and tolerates CloudBase caller metadata', () => {
  const event = {
    action: 'publishMessage',
    timestamp: now,
    appId: 'wx-app',
    message: {
      recipientUserId: '10000000-0000-4000-8000-000000000001',
      title: '活动提醒',
      body: '活动将在明天开始。',
    },
  }
  const signed = { ...event, signature: signInternalEvent(event, secret) }
  assert.equal(verifyInternalEvent({
    ...signed,
    frameworkContext: { requestId: 'framework-injected' },
    userInfo: { appId: 'framework-injected', openId: 'framework-injected' },
  }, {
    secret,
    now,
    allowedAppIds: new Set(['wx-app']),
  }).message.title, '活动提醒')
  assert.throws(() => verifyInternalEvent({
    ...signed,
    message: { ...signed.message, body: '已被修改' },
  }, {
    secret,
    now,
    allowedAppIds: new Set(['wx-app']),
  }), /FORBIDDEN/)
})

test('signature binds every field consumed by batch and reconcile actions', () => {
  const options = { secret, now, allowedAppIds: new Set(['wx-app']) }
  const batch = {
    action: 'runDeliveryBatch',
    appId: 'wx-app',
    drain: true,
    limit: 10,
    maxBatches: 5,
    timestamp: now,
  }
  const signedBatch = { ...batch, signature: signInternalEvent(batch, secret) }
  assert.equal(verifyInternalEvent({ ...signedBatch, frameworkContext: {} }, options).maxBatches, 5)
  assert.throws(() => verifyInternalEvent({ ...signedBatch, maxBatches: 4 }, options), /FORBIDDEN/)

  const reconcile = {
    action: 'reconcileDeliveryTask',
    actorUserId: '10000000-0000-4000-8000-000000000001',
    appId: 'wx-app',
    expectedEvidenceRevision: 'a'.repeat(64),
    idempotencyKey: 'notification-reconcile-1',
    nonce: 'abcdef0123456789',
    taskId: '20000000-0000-4000-8000-000000000001',
    timestamp: now,
  }
  const signedReconcile = { ...reconcile, signature: signInternalEvent(reconcile, secret) }
  assert.equal(verifyInternalEvent({ ...signedReconcile, frameworkContext: {} }, options).taskId, reconcile.taskId)
  assert.throws(() => verifyInternalEvent({ ...signedReconcile, nonce: 'changed' }, options), /FORBIDDEN/)
})
