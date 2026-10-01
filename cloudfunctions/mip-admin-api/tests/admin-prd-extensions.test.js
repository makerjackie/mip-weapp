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
  it('saves a revised deadline while keeping ended and unpublished opportunities in their current state', async () => {
    for (const status of ['UNPUBLISHED', 'ENDED']) {
      const writes = []
      const repository = extensions(database({
        async one(sql) {
          if (sql.includes('FROM mip_opportunities')) return { id: 'opportunity-a', branch_id: null, status, version: 4 }
          if (sql.includes('FROM mip_users')) return { id: 'owner-a' }
          return null
        },
        async query(sql, params) {
          writes.push({ sql, params })
          if (sql.includes('UPDATE mip_opportunities')) {
            assert.equal((sql.match(/\?/g) || []).length, params.length)
            return { affectedRows: params.slice(-4).includes(status) ? 1 : 0 }
          }
          return { affectedRows: 1 }
        },
      }))
      const result = await repository.saveOpportunity({
        appId: 'wx-app', actorUserId: 'admin-user', opportunityId: 'opportunity-a', expectedVersion: 4,
        authorizedScope: { scopeType: 'PLATFORM', scopeId: null }, authorization: {}, contentSafetyStatus: 'APPROVED',
        draft: { ownerUserId: 'owner-a', scopeType: 'PLATFORM', branchId: null, title: '机会', valueSummary: '价值',
          targetSummary: '', description: '原正文', cityTagId: null, deadlineAt: '2030-10-01T00:00:00.000Z', roleKeys: [], tagIds: [] },
        audit,
      })
      assert.deepEqual(result, { id: 'opportunity-a', status, version: 5 })
      assert.equal(writes.find(write => write.sql.includes('UPDATE mip_opportunities')).params[8], '2030-10-01T00:00:00.000Z')
      assert.ok(writes.some(write => write.sql.includes('INSERT INTO mip_audit_logs')))
    }
  })
  it('restores unpublished and ended opportunities without changing linked records and audits the transition', async () => {
    for (const status of ['UNPUBLISHED', 'ENDED']) {
      let version = 4
      let currentStatus = status
      const writes = []
      const repository = extensions(database({
        async one() { return { id: 'opportunity-a', branch_id: null, status: currentStatus, version, content_safety_status: 'APPROVED', deadline_at: null } },
        async query(sql, params) {
          writes.push({ sql, params })
          if (sql.includes('UPDATE mip_opportunities')) { currentStatus = 'PUBLISHED'; version++ }
          return { affectedRows: 1 }
        },
      }))
      const input = { appId: 'wx-app', actorUserId: 'admin-user', opportunityId: 'opportunity-a', expectedVersion: 4, authorizedScope: { scopeType: 'PLATFORM', scopeId: null }, authorization: {}, audit: audit('opportunity-a') }
      assert.deepEqual(await repository.publishOpportunity(input), { id: 'opportunity-a', status: 'PUBLISHED', version: 5 })
      assert.equal(writes.length, 2)
      assert.match(writes[0].sql, /ended_at = NULL/)
      const auditWrite = writes.find(write => write.sql.includes('INSERT INTO mip_audit_logs'))
      assert.ok(auditWrite.params.some(value => typeof value === 'string' && value.includes(`"fromStatus":"${status}"`) && value.includes('"toStatus":"PUBLISHED"')))
      await assert.rejects(() => repository.publishOpportunity(input), error => error.code === 'CONFLICT')
      assert.equal(writes.length, 2)
    }
  })
  it('rejects expired or unsafe reopening before writes', async () => {
    for (const [overrides, code] of [[{ deadline_at: '2020-01-01' }, 'INVALID_STATE'], [{ content_safety_status: 'ERROR' }, 'CONTENT_SAFETY_REQUIRED']]) {
      const writes = []
      const repository = extensions(database({ async one() { return { id: 'opportunity-a', branch_id: null, status: 'ENDED', version: 4, content_safety_status: 'APPROVED', ...overrides } }, async query(sql) { writes.push(sql); return { affectedRows: 1 } } }))
      await assert.rejects(() => repository.publishOpportunity({ appId: 'wx-app', actorUserId: 'admin-user', opportunityId: 'opportunity-a', expectedVersion: 4, authorizedScope: { scopeType: 'PLATFORM', scopeId: null }, authorization: {}, audit: audit('opportunity-a') }), error => error.code === code)
      assert.equal(writes.length, 0)
    }
  })
  it('maps editor options in query order and limits branch operators to their branch', async () => {
    const calls = []
    const repository = extensions(database({
      async query(sql, params) {
        calls.push({ sql, params })
        if (sql.includes('FROM mip_city_branches')) {
          return [{ id: 'branch-a', name: '深圳分会', city_name: '深圳' }]
        }
        if (sql.includes('FROM mip_users')) {
          return [{ id: 'owner-a', nickname: '负责人', branch_name: '深圳分会' }]
        }
        if (sql.includes('FROM mip_tags')) {
          return [
            { id: 'city-a', kind: 'CITY', label: '深圳' },
            { id: 'tag-a', kind: 'INDUSTRY', label: '企业服务' },
          ]
        }
        return []
      },
    }))

    const result = await repository.getOpportunityEditorOptions('wx-app', {
      platform: false,
      branchIds: ['branch-a'],
      eventIds: [],
    })

    assert.deepEqual(result.branches, [{ id: 'branch-a', name: '深圳分会', cityName: '深圳' }])
    assert.deepEqual(result.owners, [{ id: 'owner-a', nickname: '负责人', branchName: '深圳分会' }])
    assert.deepEqual(result.cities, [{ id: 'city-a', label: '深圳' }])
    assert.deepEqual(result.tags, [{ id: 'tag-a', kind: 'INDUSTRY', label: '企业服务' }])
    assert.deepEqual(calls.find(call => call.sql.includes('FROM mip_city_branches')).params, ['wx-app', 'branch-a'])
    assert.deepEqual(calls.find(call => call.sql.includes('FROM mip_users')).params, ['wx-app', 'branch-a', '', '', '', '', ''])

    calls.length = 0
    await repository.getOpportunityEditorOptions('wx-app', {
      platform: true,
      branchIds: [],
      eventIds: [],
    })
    assert.deepEqual(calls.find(call => call.sql.includes('FROM mip_city_branches')).params, ['wx-app'])
    assert.deepEqual(calls.find(call => call.sql.includes('FROM mip_users')).params, ['wx-app', '', '', '', '', ''])
  })

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
    const reads = []
    const writes = []
    const repository = extensions(database({
      async one(sql) {
        reads.push(sql)
        if (sql.includes('FROM mip_users')) return { id: 'owner-a' }
        if (sql.includes("kind = 'CITY'")) return { id: 'city-a' }
        return null
      },
      async query(sql, params) {
        if (sql.includes('SELECT id, kind FROM mip_tags')) {
          reads.push(sql)
          return [{ id: 'tag-a', kind: 'INDUSTRY' }]
        }
        writes.push({ sql, params })
        return { affectedRows: 1 }
      },
    }))
    const result = await repository.saveOpportunity({
      appId: 'wx-app', actorUserId: 'admin-user', opportunityId: null, expectedVersion: 0,
      authorizedScope: null, authorization: {}, contentSafetyStatus: 'APPROVED',
      draft: {
        ownerUserId: 'owner-a', scopeType: 'PLATFORM', branchId: null, title: '机会', valueSummary: '价值',
        targetSummary: '', description: '', cityTagId: 'city-a', deadlineAt: null,
        roleKeys: ['connector'], tagIds: ['tag-a'],
      },
      audit,
    })
    assert.equal(result.status, 'DRAFT')
    assert.ok(writes.some(call => /INSERT INTO mip_opportunities/.test(call.sql)))
    assert.ok(writes.some(call => /INSERT INTO mip_opportunity_roles/.test(call.sql)))
    assert.ok(writes.some(call => /INSERT INTO mip_opportunity_tags/.test(call.sql)))
    assert.ok(writes.some(call => /INSERT INTO mip_audit_logs/.test(call.sql)))
    const tagReads = reads.filter(sql => sql.includes('FROM mip_tags'))
    assert.equal(tagReads.length, 2)
    assert.equal(tagReads.every(sql => sql.includes('FOR SHARE')), true)
    assert.equal(tagReads.some(sql => sql.includes('FOR UPDATE')), false)
  })

  it('rejects a branch opportunity owner from another primary branch before writing', async () => {
    const writes = []
    const repository = extensions(database({
      async one(sql) {
        if (sql.includes('FROM mip_users')) return { id: 'owner-b', primary_branch_id: 'branch-b' }
        return null
      },
      async query(sql, params) {
        writes.push({ sql, params })
        return { affectedRows: 1 }
      },
    }))

    await assert.rejects(() => repository.saveOpportunity({
      appId: 'wx-app', actorUserId: 'admin-user', opportunityId: null, expectedVersion: 0,
      authorizedScope: null, authorization: {}, contentSafetyStatus: 'APPROVED',
      draft: {
        ownerUserId: 'owner-b', scopeType: 'BRANCH', branchId: 'branch-a', title: '机会',
        valueSummary: '价值', targetSummary: '', description: '', cityTagId: null,
        deadlineAt: null, roleKeys: [], tagIds: [],
      },
      audit,
    }), error => error?.code === 'FORBIDDEN')
    assert.equal(writes.length, 0)
  })

  it('keeps archived opportunities read-only', async () => {
    for (const status of ['ARCHIVED']) {
      const writes = []
      const repository = extensions(database({
        async one(sql) {
          if (sql.includes('FROM mip_opportunities')) {
            return { id: 'opportunity-a', branch_id: null, status, version: 4 }
          }
          return null
        },
        async query(sql, params) {
          writes.push({ sql, params })
          return { affectedRows: 1 }
        },
      }))

      await assert.rejects(() => repository.saveOpportunity({
        appId: 'wx-app', actorUserId: 'admin-user', opportunityId: 'opportunity-a', expectedVersion: 4,
        authorizedScope: { scopeType: 'PLATFORM', scopeId: null }, authorization: {}, contentSafetyStatus: 'APPROVED',
        draft: {
          ownerUserId: 'owner-a', scopeType: 'PLATFORM', branchId: null, title: '机会', valueSummary: '价值',
          targetSummary: '', description: '', cityTagId: null, deadlineAt: null, roleKeys: [], tagIds: [],
        },
        audit,
      }), error => error?.code === 'INVALID_STATE')
      assert.equal(writes.length, 0)
    }
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
        if (sql.includes('AS registrations')) return { registrations: 1, orders: 0, checkins: 0 }
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
        return { registrations: 0, orders: 0, checkins: 0 }
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
          order_id: 'order-a', payment_status: 'PAID', order_amount_cents: 1250, refunded_amount_cents: 250,
          paid_at: new Date('2026-08-24T00:00:00Z'), currency: 'CNY',
        }]
      },
    }))
    const page = await repository.listRosterAll('wx-app', { platform: false, branchIds: ['branch-a'], eventIds: [] }, {
      eventId: '', branchId: '', status: '', query: '', createdFrom: '', createdTo: '',
    }, 20)
    assert.match(captured.sql, /r\.app_id = \?/)
    assert.match(captured.sql, /e\.branch_id IN \(\?\)/)
    assert.match(captured.sql, /o\.app_id = r\.app_id AND o\.id = r\.order_id/)
    assert.match(captured.sql, /o\.user_id = r\.user_id AND o\.resource_id = r\.event_id AND o\.order_type = 'EVENT'/)
    assert.match(captured.sql, /refund\.app_id = o\.app_id AND refund\.order_id = o\.id AND refund\.status = 'SUCCEEDED'/)
    assert.deepEqual(page.items[0].answerItems, [{ key: 'company', label: '公司', value: 'MIP' }])
    assert.equal(page.items[0].paymentStatus, 'PAID')
    assert.equal(page.items[0].paidAmountCents, 1250)
    assert.equal(page.items[0].refundedAmountCents, 250)
  })
})
