'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const {
  normalizeDraft,
  relatedData,
  resolveTeamUserIds,
  syncOpportunityTeam,
} = require('../domain/opportunities')
const { createProfileRef } = require('../lib/profile-ref')

const appId = 'wx-opportunity-team'
const ownerUserId = '10000000-0000-4000-8000-000000000001'
const memberUserId = '20000000-0000-4000-8000-000000000001'
const removedUserId = '30000000-0000-4000-8000-000000000001'
const opportunityId = '40000000-0000-4000-8000-000000000001'
const pepper = 'opportunity-team-reference-secret-more-than-32-characters'
const caller = { appId, userId: ownerUserId, profileRefSecret: pepper }

function validDraft(overrides = {}) {
  return {
    title: '城市品牌合作',
    valueSummary: '提供品牌与渠道资源',
    targetSummary: '寻找一名项目负责人',
    description: '共同完成项目方案和交付。',
    scopeType: 'PLATFORM',
    roleKeys: ['delivery_lead'],
    industryTagIds: [],
    abilityTagIds: [],
    publish: true,
    ...overrides,
  }
}

describe('opportunity team draft', () => {
  it('accepts at most eight opaque profile references and defaults to an empty team', () => {
    const profileRef = createProfileRef({ appId, userId: memberUserId }, pepper)
    assert.deepEqual(normalizeDraft(validDraft()).teamProfileRefs, [])
    assert.deepEqual(normalizeDraft(validDraft({ teamProfileRefs: [profileRef, profileRef] })).teamProfileRefs, [profileRef])
    assert.throws(
      () => normalizeDraft(validDraft({ teamProfileRefs: Array.from({ length: 9 }, (_, index) => `p1.${'x'.repeat(40)}${index}`) })),
      /VALIDATION_FAILED/,
    )
  })

  it('resolves only active unblocked players and rejects the publisher', async () => {
    const profileRef = createProfileRef({ appId, userId: memberUserId }, pepper)
    const calls = []
    const tx = {
      async query(sql, params) {
        calls.push({ sql, params })
        return [{ id: memberUserId }]
      },
    }
    assert.deepEqual(await resolveTeamUserIds(tx, caller, [profileRef]), [memberUserId])
    assert.match(calls[0].sql, /mip_membership_entitlements/)
    assert.match(calls[0].sql, /mip_user_blocks/)
    assert.deepEqual(calls[0].params, [appId, memberUserId, ownerUserId, ownerUserId])

    const ownerRef = createProfileRef({ appId, userId: ownerUserId }, pepper)
    await assert.rejects(() => resolveTeamUserIds(tx, caller, [ownerRef]), /VALIDATION_FAILED/)
    await assert.rejects(() => resolveTeamUserIds(tx, caller, ['p1.invalid.reference']), /VALIDATION_FAILED/)
    await assert.rejects(
      () => resolveTeamUserIds({ query: async () => [] }, caller, [profileRef]),
      /VALIDATION_FAILED/,
    )
  })

  it('reactivates selected members and soft-removes deselected members', async () => {
    const writes = []
    const tx = {
      async query(sql, params) {
        if (sql.includes('SELECT id, user_id, status')) {
          return [
            { id: '50000000-0000-4000-8000-000000000001', user_id: memberUserId, status: 'REMOVED' },
            { id: '50000000-0000-4000-8000-000000000002', user_id: removedUserId, status: 'ACTIVE' },
          ]
        }
        writes.push({ sql, params })
        return { affectedRows: 1 }
      },
    }
    await syncOpportunityTeam(tx, caller, opportunityId, [memberUserId])
    const removal = writes.find(call => call.sql.includes("SET status = 'REMOVED'"))
    const reactivation = writes.find(call => call.sql.includes("SET status = 'ACTIVE'"))
    assert.deepEqual(removal.params, [appId, '50000000-0000-4000-8000-000000000002'])
    assert.deepEqual(reactivation.params, [0, appId, '50000000-0000-4000-8000-000000000001'])
    assert.equal(writes.some(call => /DELETE FROM mip_opportunity_team_members/.test(call.sql)), false)
  })

  it('projects active team members without exposing raw user ids', async () => {
    const database = {
      async query(sql) {
        if (sql.includes('FROM mip_opportunity_roles')) return []
        if (sql.includes('FROM mip_opportunity_tags')) return []
        if (sql.includes('FROM mip_opportunity_team_members')) {
          assert.match(sql, /mip_membership_entitlements/)
          assert.match(sql, /mip_user_blocks/)
          return [{
            opportunity_id: opportunityId,
            user_id: memberUserId,
            nickname: '成员甲',
            headline: '项目负责人',
            visibility_json: '{}',
            avatar_file_id: 'cloud://mip/member-avatar',
          }]
        }
        throw new Error(`unexpected query: ${sql}`)
      },
    }
    const result = await relatedData(database, caller, [opportunityId])
    assert.equal(result.team.get(opportunityId)[0].nickname, '成员甲')
    assert.equal(result.team.get(opportunityId)[0].userKind, 'PLAYER')
    assert.match(result.team.get(opportunityId)[0].profileRef, /^p1\./)
    assert.equal(JSON.stringify(result.team.get(opportunityId)).includes(memberUserId), false)
  })
})
