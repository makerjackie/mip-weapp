'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const { archiveOpportunity, getOpportunity, normalizeDraft, saveOpportunity, setProfileInterest } = require('../domain/opportunities')
const { createProfileRef } = require('../lib/profile-ref')

const appId = 'journey-test-app'
const owner = '10000000-0000-4000-8000-000000000001'
const id = '20000000-0000-4000-8000-000000000002'
const caller = { appId, userId: owner, profileRefSecret: 'journey-profile-reference-secret-32-characters' }
const draft = {
  id, expectedVersion: 4, title: '资源合作', valueSummary: '渠道资源',
  targetSummary: '寻找伙伴', description: '项目说明', roleKeys: ['strategist'],
  typeKeys: ['COMPANY', 'PARTNER'], regionText: '南山十亩地',
  industryTagIds: [], abilityTagIds: [], publish: true,
}

function fixture(overrides = {}) {
  const calls = []
  const row = {
    id, owner_user_id: owner, status: 'PUBLISHED', version: 4,
    title: draft.title, value_summary: draft.valueSummary, target_summary: draft.targetSummary,
    region_text: draft.regionText, type_keys_json: JSON.stringify(draft.typeKeys),
    description: draft.description, published_at: '2026-09-22T00:00:00.000Z', ...overrides,
  }
  const tx = {
    async one(sql, params) {
      calls.push({ sql, params })
      if (sql.includes('FROM mip_users')) return { id: owner, status: 'ACTIVE' }
      if (sql.includes('FROM mip_opportunities')) return row
      return null
    },
    async query(sql, params) {
      calls.push({ sql, params })
      return /^\s*SELECT/.test(sql) ? [] : { affectedRows: 1 }
    },
  }
  return { row, calls, db: { ...tx, async transaction(work) { return work(tx) } } }
}

for (const status of ['PUBLISHED', 'UNPUBLISHED', 'ENDED']) {
  test(`saves fields and ${status} in one versioned owner transaction`, async () => {
    const f = fixture()
    const result = await saveOpportunity(f.db, { async assertSafe() {} }, caller, {
      draft: { ...draft, publicationStatus: status }, idempotencyKey: `journey-${status}`,
    })
    assert.deepEqual(result, { id, status, version: 5 })
    const writes = f.calls.filter(call => call.sql.includes('UPDATE mip_opportunities'))
    assert.equal(writes.length, 1)
    assert.match(writes[0].sql, /region_text = \?, type_keys_json = \?/)
    assert.match(writes[0].sql, /WHERE app_id = \? AND id = \? AND version = \?/)
    assert.ok(writes[0].params.includes('南山十亩地'))
    assert.ok(writes[0].params.includes('["COMPANY","PARTNER"]'))
    assert.ok(writes[0].params.includes(status))
    assert.ok(f.calls.some(call => call.sql.includes('INSERT INTO mip_audit_logs')))
  })
}

test('non-empty detail projects saved region and the exact three opportunity types', async () => {
  const f = fixture()
  const result = await getOpportunity(f.db, caller, id)
  assert.equal(result.regionText, draft.regionText)
  assert.deepEqual(result.typeKeys, draft.typeKeys)
  assert.equal(result.title, draft.title)
})

test('unpublished content is owner-only and moderation takedowns cannot be bypassed', async () => {
  const f = fixture({ status: 'UNPUBLISHED', moderated_by_user_id: 'operator' })
  assert.equal((await getOpportunity(f.db, caller, id)).canEdit, false)
  await assert.rejects(() => getOpportunity(f.db, { ...caller, userId: 'other-user' }, id), /NOT_FOUND/)
  await assert.rejects(() => saveOpportunity(f.db, { async assertSafe() {} }, caller, {
    draft, idempotencyKey: 'journey-moderation-bypass',
  }), /FORBIDDEN/)
  assert.equal(f.calls.some(call => call.sql.includes('UPDATE mip_opportunities')), false)
})

test('owner can republish an owner-unpublished project but stale versions fail', async () => {
  const f = fixture({ status: 'UNPUBLISHED' })
  const result = await saveOpportunity(f.db, { async assertSafe() {} }, caller, {
    draft, idempotencyKey: 'journey-republish',
  })
  assert.equal(result.status, 'PUBLISHED')
  await assert.rejects(() => saveOpportunity(f.db, { async assertSafe() {} }, caller, {
    draft: { ...draft, expectedVersion: 1 }, idempotencyKey: 'journey-stale',
  }), /CONFLICT/)
})

test('validates type keys, region length and publication state on the server', () => {
  assert.deepEqual(normalizeDraft(draft).typeKeys, ['COMPANY', 'PARTNER'])
  for (const invalid of [
    { typeKeys: ['ADMIN'] }, { typeKeys: 'COMPANY' },
    { regionText: '地'.repeat(61) }, { publicationStatus: 'ARCHIVED' },
  ]) assert.throws(() => normalizeDraft({ ...draft, ...invalid }), /VALIDATION_FAILED/)
})

test('a profile interest activation requires a current server-confirmed membership', async () => {
  const f = fixture()
  const profileRef = createProfileRef({ appId, userId: id }, caller.profileRefSecret)
  await assert.rejects(() => setProfileInterest(f.db, caller, {
    sourceType: 'PROFILE', profileRef, active: true, idempotencyKey: 'guest-interest-forbidden',
  }), /FORBIDDEN/)
  assert.equal(f.calls.some(call => call.sql.includes('INSERT INTO mip_profile_interests')), false)
  const membership = f.calls.find(call => call.sql.includes('FROM mip_membership_entitlements'))
  assert.deepEqual(membership.params, [appId, owner])
  assert.match(membership.sql, /starts_at <= UTC_TIMESTAMP\(3\).*ends_at > UTC_TIMESTAMP\(3\)/s)
})

for (const status of ['DRAFT', 'PUBLISHED', 'ENDED', 'UNPUBLISHED']) {
  test(`owner can delete ${status} while keeping publication history and audit`, async () => {
    const f = fixture({ status })
    const result = await archiveOpportunity(f.db, caller, { id, expectedVersion: 4, idempotencyKey: `archive-${status}` })
    assert.equal(result.status, 'ARCHIVED')
    const write = f.calls.find(call => call.sql.includes('UPDATE mip_opportunities'))
    assert.match(write.sql, /archived_by_user_id = \?/)
    assert.doesNotMatch(write.sql, /published_at = NULL|DELETE FROM/)
    assert.deepEqual(write.params, [owner, appId, id, 4])
  })
}

test('owner deletion rejects another owner, stale version and already archived content', async () => {
  for (const [override, error] of [[{ owner_user_id: 'someone-else' }, /FORBIDDEN/], [{ version: 9 }, /CONFLICT/], [{ status: 'ARCHIVED' }, /CONFLICT/]]) {
    const f = fixture(override)
    await assert.rejects(() => archiveOpportunity(f.db, caller, { id, expectedVersion: 4, idempotencyKey: 'archive-reject-test' }), error)
    assert.equal(f.calls.some(call => call.sql.includes('UPDATE mip_opportunities')), false)
  }
})
