'use strict'

const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const { describe, it } = require('node:test')
const {
  attachInvitationCodeAsset,
  issueInvitationLink,
  parseInvitationScene,
  resolveInvitationScene,
} = require('../domain/event-service')

const appId = 'wx-app'
const eventId = '10000000-0000-4000-8000-000000000001'
const userId = '20000000-0000-4000-8000-000000000001'
const now = new Date('2026-08-24T03:00:00.000Z')
const tokenSecret = 'event-invitation-token-secret'

describe('MIP invitation mini-program scene', () => {
  it('issues an AppID-scoped short invitation scene after active-user validation', async () => {
    const calls = []
    const tx = {
      async one(sql) {
        calls.push(String(sql))
        if (String(sql).includes('FROM mip_users')) return { id: userId, status: 'ACTIVE' }
        return { id: eventId }
      },
      async query(sql, params) {
        calls.push({ sql: String(sql), params })
        if (String(sql).includes('INSERT INTO mip_event_invitation_links')) {
          assert.equal(params[4].length, 11)
          assert.match(params[5], /^[0-9a-f]{64}$/)
        }
        return { affectedRows: 1 }
      },
    }
    const result = await issueInvitationLink({ transaction: work => work(tx) }, {
      appId,
      eventId,
      userId,
      now,
    })
    assert.match(result.scene, /^i1\.[A-Za-z0-9_-]{11}\.[A-Za-z0-9_-]{11}$/)
    assert.ok(result.scene.length <= 32)
    assert.equal(result.scene.includes(result.invitationId), false)
    assert.ok(calls.some(call => call.params?.includes('EVENT_INVITATION_CODE_CREATED')))
  })

  it('resolves an active scene into a signed invitation without exposing the inviter identity', async () => {
    const scene = 'i1.abcdefghijk.lmnopqrstuv'
    const result = await resolveInvitationScene({
      async one(sql, params) {
        assert.match(sql, /mip_event_invitation_links/)
        assert.equal(params[0], appId)
        assert.equal(params[1], 'abcdefghijk')
        assert.equal(params[2], createHash('sha256').update('lmnopqrstuv').digest('hex'))
        return {
          event_id: eventId,
          inviter_user_id: userId,
          expires_at: '2026-09-01T03:00:00.000Z',
        }
      },
    }, {
      appId,
      scene,
      tokenSecret,
      now,
    })
    assert.equal(result.eventId, eventId)
    assert.ok(result.invitationToken)
    assert.equal(JSON.stringify(result).includes(userId), false)
    assert.equal(parseInvitationScene(scene).reference, 'abcdefghijk')
    assert.throws(() => parseInvitationScene('s1.abcdefghijk.lmnopqrstuv'), error => error.code === 'VALIDATION_FAILED')
  })

  it('attaches only the freshly generated asset to its active owner link', async () => {
    const invitationId = '30000000-0000-4000-8000-000000000001'
    const assetId = '40000000-0000-4000-8000-000000000001'
    let updateParams
    const database = {
      transaction: work => work({
        async one() {
          return { id: invitationId, code_asset_id: null, status: 'ACTIVE', expires_at: '2026-09-01T03:00:00.000Z' }
        },
        async query(sql, params) {
          assert.match(sql, /SET code_asset_id = \?/)
          updateParams = params
          return { affectedRows: 1 }
        },
      }),
    }
    assert.deepEqual(await attachInvitationCodeAsset(database, {
      appId,
      invitationId,
      userId,
      assetId,
      now,
    }), { invitationId, assetId })
    assert.deepEqual(updateParams.slice(0, 4), [assetId, appId, invitationId, userId])
  })
})
