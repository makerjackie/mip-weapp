'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const {
  getOpportunity,
  listOpportunities,
  setProfileInterest,
  setReferral,
} = require('../domain/opportunities')
const { getCooperationCard, listCooperationCards } = require('../domain/cooperation')
const { getSuperCase, listSuperCases } = require('../domain/cases')

const appId = 'wx-app'
const viewerUserId = '10000000-0000-4000-8000-000000000001'
const resourceId = '20000000-0000-4000-8000-000000000001'
const caller = {
  appId,
  userId: viewerUserId,
  grants: [],
  profileRefSecret: 'block-visibility-profile-ref-secret-more-than-32-characters',
}

function assertMutualBlock(sql, subjectSql, appSql) {
  assert.match(sql, /FROM mip_user_blocks visibility_block/)
  assert.match(sql, new RegExp(`visibility_block\\.app_id = ${appSql.replace('.', '\\.')}.*status = 'ACTIVE'`, 's'))
  assert.match(sql, new RegExp(`blocker_user_id = \\? AND visibility_block\\.blocked_user_id = ${subjectSql.replace('.', '\\.')}`))
  assert.match(sql, new RegExp(`blocker_user_id = ${subjectSql.replace('.', '\\.')} AND visibility_block\\.blocked_user_id = \\?`))
}

describe('public opportunity visibility', () => {
  it('filters opportunity, cooperation-card, and super-case lists in the database', async () => {
    const calls = []
    const database = {
      async query(sql, params) {
        calls.push({ sql, params })
        return []
      },
    }

    await listOpportunities(database, caller, {})
    await listCooperationCards(database, caller, {})
    await listSuperCases(database, caller, {})

    const opportunity = calls.find(call => call.sql.includes('FROM mip_opportunities o'))
    const cooperation = calls.find(call => call.sql.includes('FROM mip_cooperation_cards c'))
    const superCase = calls.find(call => call.sql.includes('FROM mip_super_cases c'))
    assertMutualBlock(opportunity.sql, 'o.owner_user_id', 'o.app_id')
    assertMutualBlock(cooperation.sql, 'c.owner_user_id', 'c.app_id')
    assertMutualBlock(superCase.sql, 'c.owner_user_id', 'c.app_id')
    for (const call of [opportunity, cooperation, superCase]) {
      assert.deepEqual(call.params.slice(-2), [viewerUserId, viewerUserId])
    }
  })

  it('returns NOT_FOUND for a blocked resource detail without revealing block direction', async () => {
    const calls = []
    const database = {
      async one(sql, params) {
        calls.push({ sql, params })
        return null
      },
    }

    for (const load of [getOpportunity, getCooperationCard, getSuperCase]) {
      await assert.rejects(() => load(database, caller, resourceId), /NOT_FOUND/)
    }

    assertMutualBlock(calls[0].sql, 'o.owner_user_id', 'o.app_id')
    assertMutualBlock(calls[1].sql, 'c.owner_user_id', 'c.app_id')
    assertMutualBlock(calls[2].sql, 'c.owner_user_id', 'c.app_id')
    for (const call of calls) {
      assert.deepEqual(call.params, [appId, resourceId, viewerUserId, viewerUserId])
    }
  })

  it('keeps anonymous public lists independent of the block table', async () => {
    const calls = []
    const anonymous = { ...caller, userId: null }
    const database = {
      async query(sql, params) {
        calls.push({ sql, params })
        return []
      },
    }

    await listOpportunities(database, anonymous, {})
    await listCooperationCards(database, anonymous, {})
    await listSuperCases(database, anonymous, {})

    assert.equal(calls.some(call => call.sql.includes('mip_user_blocks')), false)
  })
})

async function captureRejectedMutation(run) {
  const calls = []
  const tx = {
    async one(sql, params) {
      calls.push({ sql, params })
      if (sql.includes('FROM mip_users')) {
        return { id: viewerUserId, status: 'ACTIVE' }
      }
      return null
    },
    async query(sql, params) {
      calls.push({ sql, params })
      return { affectedRows: 1 }
    },
  }
  await assert.rejects(() => run({ transaction: work => work(tx) }), /NOT_FOUND/)
  return calls.find(call => call.sql.includes('mip_user_blocks'))
}

describe('opportunity interaction visibility', () => {
  it('rechecks either block direction when adding or cancelling a referral', async () => {
    for (const active of [true, false]) {
      const call = await captureRejectedMutation(database => setReferral(database, caller, {
        id: resourceId,
        active,
        note: '',
        idempotencyKey: `referral-block-${active}-stable-key`,
      }))
      assertMutualBlock(call.sql, 'o.owner_user_id', 'o.app_id')
      assert.deepEqual(call.params, [appId, resourceId, viewerUserId, viewerUserId])
      assert.match(call.sql, /FOR UPDATE/)
    }
  })

  it('rechecks either block direction when adding or cancelling resource interest', async () => {
    for (const active of [true, false]) {
      const call = await captureRejectedMutation(database => setProfileInterest(database, caller, {
        sourceType: 'COOPERATION_CARD',
        sourceId: resourceId,
        active,
        idempotencyKey: `interest-block-${active}-stable-key`,
      }))
      assertMutualBlock(call.sql, 'resource.owner_user_id', 'resource.app_id')
      assert.deepEqual(call.params, [appId, resourceId, viewerUserId, viewerUserId])
      assert.match(call.sql, /FOR UPDATE/)
    }
  })
})
