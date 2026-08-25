'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const {
  canOwnerEditOpportunity,
  getOpportunity,
  saveOpportunity,
} = require('../domain/opportunities')

const appId = 'trusted-app'
const opportunityId = '00000000-0000-4000-8000-000000000001'
const ownerUserId = '10000000-0000-4000-8000-000000000001'

function endedOpportunity() {
  return {
    id: opportunityId,
    owner_user_id: ownerUserId,
    branch_id: null,
    title: '已结束的合作机会',
    value_summary: '资源合作',
    target_summary: '寻找合作伙伴',
    description: '机会说明',
    status: 'ENDED',
    referral_count: 0,
    version: 4,
    published_at: '2026-08-24T00:00:00.000Z',
    nickname: '发布人',
  }
}

test('ENDED is outside the owner-editable opportunity state set', () => {
  assert.equal(canOwnerEditOpportunity('DRAFT'), true)
  assert.equal(canOwnerEditOpportunity('PUBLISHED'), true)
  assert.equal(canOwnerEditOpportunity('ENDED'), false)
  assert.equal(canOwnerEditOpportunity('UNPUBLISHED'), false)
  assert.equal(canOwnerEditOpportunity('ARCHIVED'), false)
})

test('owner detail projects an ended opportunity as read-only', async () => {
  const database = {
    async one(sql) {
      if (sql.includes('FROM mip_opportunities o')) return endedOpportunity()
      if (sql.includes('FROM mip_referral_intents')) return null
      if (sql.includes('FROM mip_profile_interests')) return null
      throw new Error(`unexpected one: ${sql}`)
    },
    async query() { return [] },
  }

  const result = await getOpportunity(database, {
    appId,
    userId: ownerUserId,
    profileRefSecret: 'profile-reference-secret-with-at-least-32-characters',
  }, opportunityId)

  assert.equal(result.status, 'ENDED')
  assert.equal(result.mine, true)
  assert.equal(result.canEdit, false)
})

test('owner save API cannot edit or republish an ended opportunity', async () => {
  for (const publish of [false, true]) {
    const writes = []
    const tx = {
      async one(sql) {
        if (sql.includes('FROM mip_users')) return { id: ownerUserId, status: 'ACTIVE' }
        if (sql.includes('FROM mip_idempotency_keys')) return null
        if (sql.includes('FROM mip_opportunities')) return endedOpportunity()
        throw new Error(`unexpected one: ${sql}`)
      },
      async query(sql) {
        writes.push(sql)
        return { affectedRows: 1 }
      },
    }

    await assert.rejects(() => saveOpportunity({
      async transaction(work) { return work(tx) },
    }, {
      async assertSafe() {},
    }, {
      appId,
      userId: ownerUserId,
    }, {
      idempotencyKey: `ended-save-${publish ? 'publish' : 'draft'}`,
      draft: {
        id: opportunityId,
        expectedVersion: 4,
        title: '已结束的合作机会',
        valueSummary: '资源合作',
        targetSummary: '寻找合作伙伴',
        description: '机会说明',
        roleKeys: ['strategist'],
        industryTagIds: [],
        abilityTagIds: [],
        publish,
      },
    }), /FORBIDDEN/)

    assert.equal(writes.some(sql => sql.includes('UPDATE mip_opportunities')), false)
    assert.equal(writes.some(sql => sql.includes('DELETE FROM mip_opportunity_')), false)
  }
})
