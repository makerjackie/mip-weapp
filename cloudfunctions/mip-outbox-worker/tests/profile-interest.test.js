'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const { projectEvent } = require('../domain/projector')

test('projects direct public-profile interest from current relational facts', async () => {
  const relationId = '10000000-0000-4000-8000-000000000001'
  const targetUserId = '20000000-0000-4000-8000-000000000001'
  const event = {
    id: '30000000-0000-4000-8000-000000000001',
    app_id: 'wx-profile-interest',
    aggregate_type: 'PROFILE_INTEREST',
    aggregate_id: relationId,
    event_type: 'profile.interest_changed',
    source_version: 2,
    payload_json: { recipientUserId: 'attacker-controlled' },
  }
  const calls = []
  const result = await projectEvent({
    async one(sql, params) {
      calls.push({ sql, params })
      if (sql.includes('FROM mip_profile_interests i')) {
        return {
          status: 'ACTIVE',
          version: 2,
          target_user_id: targetUserId,
          source_type: 'PROFILE',
          source_id: targetUserId,
        }
      }
      if (sql.includes('FROM mip_users target')) return { id: targetUserId }
      throw new Error(`unexpected query: ${sql}`)
    },
  }, event)

  assert.equal(result.reason, 'PROJECTED')
  assert.equal(result.notifications.length, 1)
  assert.equal(result.notifications[0].recipientUserId, targetUserId)
  assert.equal(result.notifications[0].title, '公开档案收到新的关注')
  assert.equal(result.notifications[0].dedupeKey, `outbox:${event.id}:profile-interest`)
  assert.equal(JSON.stringify(result).includes('attacker-controlled'), false)
  assert.deepEqual(calls[1].params, [event.app_id, targetUserId])
})
