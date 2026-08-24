'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const { createNotificationsService } = require('../domain/service')
const { revealRecipient } = require('../../mip-notification-worker/lib/recipient-protection')

const key = 'notification-key-that-is-longer-than-thirty-two-bytes'
const appId = 'wx-app'
const userId = '10000000-0000-4000-8000-000000000001'
const grantId = '20000000-0000-4000-8000-000000000001'

test('records an accepted grant without returning OpenID or ciphertext', async () => {
  let captured
  const repository = {
    async createGrant(input) {
      captured = input
      return { templateKey: input.templateKey, decision: 'ACCEPTED', grantAvailable: true }
    },
  }
  const service = createNotificationsService({
    repository,
    encryptionKey: key,
    templates: { EVENT_REMINDER: { templateId: 'template-id', fields: { title: 'thing1' } } },
    createId: () => grantId,
    randomBytes: size => Buffer.alloc(size, 4),
  })
  const result = await service.recordSubscriptionDecision({ appId, userId, openId: 'openid-private' }, {
    templateKey: 'EVENT_REMINDER',
    decision: 'ACCEPTED',
  })
  assert.deepEqual(result, { templateKey: 'EVENT_REMINDER', decision: 'ACCEPTED', grantAvailable: true })
  assert.equal(captured.recipientHash.length, 64)
  assert.equal(Buffer.isBuffer(captured.recipientCiphertext), true)
  assert.equal(JSON.stringify(result).includes('openid-private'), false)
  assert.equal(revealRecipient(captured.recipientCiphertext, key, {
    appId,
    userId,
    grantId,
    templateKey: 'EVENT_REMINDER',
  }), 'openid-private')
})

test('revokes available grants when the user bans a template', async () => {
  let revoked
  const service = createNotificationsService({
    repository: {
      async revokeGrants(...args) { revoked = args },
    },
  })
  await assert.doesNotReject(async () => {
    const result = await service.recordSubscriptionDecision({ appId, userId }, {
      templateKey: 'EVENT_REMINDER',
      decision: 'BANNED',
    })
    assert.deepEqual(result, {
      templateKey: 'EVENT_REMINDER',
      decision: 'BANNED',
      grantAvailable: false,
    })
  })
  assert.deepEqual(revoked, [appId, userId, 'EVENT_REMINDER'])
})
