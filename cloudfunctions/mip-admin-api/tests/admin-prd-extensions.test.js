'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const { createAdminPrdExtensions } = require('../domain/admin-prd-extensions')
const { withTestAuthorization } = require('./test-authorization')

function database({ one = async () => null, query = async () => [], transaction } = {}) {
  const adapter = { one, query }
  adapter.transaction = transaction || (async work => work({ one, query }))
  return adapter
}

function extensions(adapter, options = {}) {
  return createAdminPrdExtensions(adapter, withTestAuthorization({
    id: () => '00000000-0000-4000-8000-000000000099',
    ...options,
  }))
}

function audit(resourceId) {
  return {
    appId: 'wx-app', actorUserId: 'admin-user', scopeType: 'PLATFORM', scopeId: null,
    action: 'admin.test', resourceType: 'TEST', resourceId, effectiveRole: 'PLATFORM_OWNER', metadata: {},
  }
}

describe('admin PRD extension persistence', () => {
  it('returns the opportunity deadline, editable relationships, and app-scoped audit history', async () => {
    const calls = []
    const repository = extensions(database({
      async one(sql, params) {
        calls.push({ sql, params })
        return {
          id: 'opportunity-a', owner_user_id: 'owner-a', owner_nickname: '发布人', title: '合作机会',
          value_summary: '价值', target_summary: '目标', description: '详情', scope_type: 'PLATFORM',
          city_tag_id: 'city-a', city_name: '广州', role_keys: 'connector', tag_ids: 'tag-a', tag_labels: '品牌',
          cover_asset_id: 'cover-a', cover_file_id: 'cloud://mip/cover-a.jpg',
          status: 'DRAFT', content_safety_status: 'APPROVED', referral_count: 0, deadline_at: new Date('2026-09-01T00:00:00Z'),
          version: 2, updated_at: new Date('2026-08-24T00:00:00Z'),
        }
      },
      async query(sql, params) {
        calls.push({ sql, params })
        if (sql.includes('FROM mip_audit_logs')) return [{ id: 1, action: 'admin.opportunities.create', actor_nickname: '运营', metadata_json: '{}', created_at: new Date('2026-08-24T00:00:00Z') }]
        if (sql.includes('FROM mip_opportunity_team_members')) return [{ user_id: 'member-a', nickname: '玩家甲', branch_name: '广州分会' }]
        return []
      },
    }))
    const item = await repository.getOpportunityDetail('wx-app', 'opportunity-a')
    assert.equal(item.deadlineAt, '2026-09-01T00:00:00.000Z')
    assert.equal(item.ownerUserId, 'owner-a')
    assert.equal(item.coverAssetId, 'cover-a')
    assert.equal(item.coverUrl, 'cloud://mip/cover-a.jpg')
    assert.deepEqual(item.tagIds, ['tag-a'])
    assert.deepEqual(item.teamMembers, [{ userId: 'member-a', nickname: '玩家甲', branchName: '广州分会' }])
    assert.equal(item.history[0].actorNickname, '运营')
    const history = calls.find(call => call.sql.includes('FROM mip_audit_logs'))
    assert.deepEqual(history.params, ['wx-app', 'opportunity-a'])
  })

  it('ends a published opportunity with scope, version, and audit checks in one transaction', async () => {
    const writes = []
    const repository = extensions(database({
      async one() { return { id: 'opportunity-a', branch_id: null, status: 'PUBLISHED', version: 4 } },
      async query(sql, params) {
        writes.push({ sql, params })
        return { affectedRows: 1 }
      },
    }))
    const result = await repository.endOpportunity({
      appId: 'wx-app', actorUserId: 'admin-user', opportunityId: 'opportunity-a', expectedVersion: 4,
      authorizedScope: { scopeType: 'PLATFORM', scopeId: null }, authorization: {}, audit: audit('opportunity-a'),
    })
    assert.deepEqual(result, { id: 'opportunity-a', status: 'ENDED', version: 5 })
    assert.ok(writes.some(call => /SET status = 'ENDED', ended_at = UTC_TIMESTAMP\(3\)/.test(call.sql)))
    assert.ok(writes.some(call => /INSERT INTO mip_audit_logs/.test(call.sql)))
  })

  it('creates an opportunity and its selected role and tag inside one audited transaction', async () => {
    const writes = []
    const repository = extensions(database({
      async one(sql) { return sql.includes('FROM mip_users') ? { id: 'owner-a' } : null },
      async query(sql, params) {
        if (sql.includes('SELECT id, kind FROM mip_tags')) return [{ id: 'tag-a', kind: 'INDUSTRY' }]
        writes.push({ sql, params })
        return { affectedRows: 1 }
      },
    }))
    const result = await repository.saveOpportunity({
      appId: 'wx-app', actorUserId: 'admin-user', opportunityId: null, expectedVersion: 0,
      authorizedScope: null, authorization: {}, contentSafetyStatus: 'APPROVED',
      draft: {
        ownerUserId: 'owner-a', scopeType: 'PLATFORM', branchId: null, title: '机会', valueSummary: '价值',
        targetSummary: '', description: '', cityTagId: null, deadlineAt: null,
        roleKeys: ['connector'], tagIds: ['tag-a'],
      },
      audit,
    })
    assert.equal(result.status, 'DRAFT')
    assert.ok(writes.some(call => /INSERT INTO mip_opportunities/.test(call.sql)))
    assert.ok(writes.some(call => /INSERT INTO mip_opportunity_roles/.test(call.sql)))
    assert.ok(writes.some(call => /INSERT INTO mip_opportunity_tags/.test(call.sql)))
    assert.ok(writes.some(call => /INSERT INTO mip_audit_logs/.test(call.sql)))
  })

  it('reads independent benefits and preserves legacy benefit copy for migration compatibility', async () => {
    const repository = extensions(database({
      async query(sql) {
        if (sql.includes('FROM mip_growth_levels')) return [{
          id: 'level-a', level_key: 'base', name: '基础', display_badge: '基础', minimum_experience: 0,
          sort_order: 1, benefits_json: '["旧权益"]', status: 'ACTIVE', version: 2,
        }]
        if (sql.includes('FROM mip_growth_level_benefits')) return [{
          level_id: 'level-a', id: 'benefit-a', name: '新权益', description: '说明', sort_order: 1, status: 'ACTIVE', version: 1,
        }]
        return []
      },
    }))
    const [level] = await repository.listGrowthLevelsV2('wx-app')
    assert.equal(level.sortOrder, 1)
    assert.equal(level.displayBadge, '基础')
    assert.equal(level.benefits[0].name, '新权益')
    assert.deepEqual(level.legacyBenefits, ['旧权益'])
  })

  it('blocks draft event archival when durable participation facts exist and archives an empty draft', async () => {
    const event = { id: 'event-a', branch_id: null, status: 'DRAFT', version: 2 }
    const blocked = extensions(database({
      async one(sql) {
        if (sql.includes('FROM mip_events')) return event
        if (sql.includes('AS registrations')) return { registrations: 1, orders: 0, checkins: 0, album_photos: 0 }
        return null
      },
    }))
    await assert.rejects(() => blocked.archiveEvent({
      appId: 'wx-app', actorUserId: 'admin-user', eventId: 'event-a', expectedVersion: 2,
      reason: '归档', authorizedScope: { scopeType: 'EVENT', scopeId: 'event-a', branchId: null }, authorization: {}, audit: audit('event-a'),
    }), error => error.code === 'EVENT_ARCHIVE_BLOCKED' && error.details.registrations === 1)

    const writes = []
    const empty = extensions(database({
      async one(sql) {
        if (sql.includes('FROM mip_events')) return event
        return { registrations: 0, orders: 0, checkins: 0, album_photos: 0 }
      },
      async query(sql) { writes.push(sql); return { affectedRows: 1 } },
    }))
    const result = await empty.archiveEvent({
      appId: 'wx-app', actorUserId: 'admin-user', eventId: 'event-a', expectedVersion: 2,
      reason: '归档', authorizedScope: { scopeType: 'EVENT', scopeId: 'event-a', branchId: null }, authorization: {}, audit: audit('event-a'),
    })
    assert.equal(result.status, 'ARCHIVED')
    assert.ok(writes.some(sql => /UPDATE mip_events SET status = 'ARCHIVED'/.test(sql)))
  })

  it('returns cross-event participants with schema labels under app and visibility constraints', async () => {
    let captured
    const repository = extensions(database({
      async query(sql, params) {
        captured = { sql, params }
        return [{
          id: 'registration-a', event_id: 'event-a', event_title: '活动', branch_id: 'branch-a', branch_name: '广州分会',
          user_id: 'user-a', nickname: '用户', city_name: '广州', status: 'REGISTERED', answers_json: '{"company":"MIP"}',
          registration_schema_json: '[{"key":"company","label":"公司"}]', phone_verified_at: new Date(),
          created_at: new Date('2026-08-24T00:00:00Z'), version: 1,
        }]
      },
    }))
    const page = await repository.listRosterAll('wx-app', { platform: false, branchIds: ['branch-a'], eventIds: [] }, {
      eventId: '', branchId: '', status: '', query: '', createdFrom: '', createdTo: '',
    }, 20)
    assert.match(captured.sql, /r\.app_id = \?/)
    assert.match(captured.sql, /e\.branch_id IN \(\?\)/)
    assert.deepEqual(page.items[0].answerItems, [{ key: 'company', label: '公司', value: 'MIP' }])
  })
})
