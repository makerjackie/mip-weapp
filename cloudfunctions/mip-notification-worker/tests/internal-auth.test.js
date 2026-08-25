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
  assert.throws(() => verifyInternalEvent({
    ...signed,
    unsignedBusinessField: true,
  }, {
    secret,
    now,
    allowedAppIds: new Set(['wx-app']),
  }), /FORBIDDEN/)
})
