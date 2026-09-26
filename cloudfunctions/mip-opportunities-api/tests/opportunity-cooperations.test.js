'use strict'
const assert = require('node:assert/strict')
const { test } = require('node:test')
const { setOpportunityCooperation, listOpportunityCooperators, cooperationSummaries } = require('../domain/opportunity-cooperations')
const caller = { appId: 'wx-test', userId: '10000000-0000-4000-8000-000000000001', profileRefSecret: 'cooperation-tests-secret-over-thirty-two-characters' }
const opportunityId = '20000000-0000-4000-8000-000000000001'
const ownerId = '30000000-0000-4000-8000-000000000001'

function fixture({ stored = null, status = 'PUBLISHED', eligible = true, owner = ownerId } = {}) {
  const writes = []
  const reads = []
  const tx = {
    async one(sql, params) {
      reads.push({ sql, params })
      if (sql.includes('FROM mip_idempotency_keys')) return null
      if (sql.includes('FROM mip_users')) return { id: caller.userId, status: 'ACTIVE' }
      if (sql.includes('FROM mip_opportunities o')) return { id: opportunityId, owner_user_id: owner, status }
      if (sql.includes('FROM mip_membership_entitlements')) return eligible ? { id: 'entitlement' } : null
      if (sql.includes('FROM mip_event_checkins')) return null
      if (sql.includes('FROM mip_opportunity_cooperations')) return stored
      throw new Error('Unexpected query')
    },
    async query(sql, params) { writes.push({ sql, params }); return [] },
  }
  return { ...tx, transaction: async work => work(tx), writes, reads }
}
const input = active => ({ id: opportunityId, active, idempotencyKey: 'cooperation-test-unique-key' })

test('self cooperation creates one independent fact and notification, without referral or reward writes', async () => {
  const db = fixture()
  assert.deepEqual(await setOpportunityCooperation(db, caller, input(true)), { active: true, version: 1 })
  const insert = db.writes.find(row => row.sql.includes('INSERT INTO mip_opportunity_cooperations'))
  assert.equal(insert.params[0], caller.appId)
  assert.equal(insert.params[2], opportunityId)
  assert.equal(insert.params[3], caller.userId)
  assert.ok(db.writes.some(row => row.sql.includes('mip_outbox_events') && row.params.includes('opportunity.cooperation_changed')))
  assert.ok(!db.writes.some(row => /mip_referral_intents|mip_growth_accounts/.test(row.sql)))
  const access = db.reads.find(row => row.sql.includes('FROM mip_opportunities o'))
  assert.match(access.sql, /players_only/)
  assert.match(access.sql, /mip_user_blocks/)
  assert.match(access.sql, /FOR UPDATE/)
})

test('repeat activation is a no-op and cancelled records reactivate in place', async () => {
  const id = '40000000-0000-4000-8000-000000000001'
  const repeat = fixture({ stored: { id, status: 'ACTIVE', version: 2 } })
  assert.deepEqual(await setOpportunityCooperation(repeat, caller, input(true)), { active: true, version: 2 })
  assert.ok(!repeat.writes.some(row => /mip_opportunity_cooperations|mip_outbox_events/.test(row.sql)))
  const reactivate = fixture({ stored: { id, status: 'CANCELLED', version: 2 } })
  assert.deepEqual(await setOpportunityCooperation(reactivate, caller, input(true)), { active: true, version: 3 })
  assert.ok(reactivate.writes.some(row => row.sql.includes('UPDATE mip_opportunity_cooperations') && row.params.includes(id)))
})

test('ended opportunities allow cancellation but reject new intent; ineligible and own intent are rejected', async () => {
  const db = fixture({ status: 'ENDED', stored: { id: opportunityId, status: 'ACTIVE', version: 1 } })
  assert.deepEqual(await setOpportunityCooperation(db, caller, input(false)), { active: false, version: 2 })
  await assert.rejects(setOpportunityCooperation(fixture({ status: 'ENDED' }), caller, input(true)), /CONFLICT/)
  await assert.rejects(setOpportunityCooperation(fixture({ eligible: false }), caller, input(true)), /FORBIDDEN/)
  await assert.rejects(setOpportunityCooperation(fixture({ owner: caller.userId }), caller, input(true)), /CONFLICT/)
  await assert.rejects(setOpportunityCooperation(fixture(), caller, { ...input(true), active: 'true' }), /VALIDATION_FAILED/)
})

test('nonempty cooperator list uses public profile references and respects visibility in both preview and list', async () => {
  const row = { id: opportunityId, opportunity_id: opportunityId, user_id: caller.userId, nickname: 'private nickname',
    avatar_file_id: 'cloud://private-avatar', headline: 'private headline', visibility_json: { nickname: false, avatar: false, headline: false },
    activated_at: '2026-09-26T00:00:00.000Z', cooperation_count: 2 }
  const db = fixture()
  const queries = []
  db.query = async (sql) => { queries.push(sql); return [row, { ...row, id: ownerId }] }
  const list = await listOpportunityCooperators(db, caller, { id: opportunityId, limit: 1 })
  assert.equal(list.items.length, 1)
  assert.match(list.items[0].profileRef, /^p1\./)
  assert.equal(list.items[0].nickname, 'MIP 用户')
  assert.equal(list.items[0].avatarUrl, undefined)
  assert.ok(!JSON.stringify(list).includes(caller.userId))
  assert.ok(list.nextCursor)
  const summary = await cooperationSummaries(db, caller, [opportunityId])
  assert.deepEqual(summary.get(opportunityId), { count: 2, avatars: [] })
  assert.ok(queries.every(sql => sql.includes('mip_user_blocks') && sql.includes("member.status = 'ACTIVE'")))
})
