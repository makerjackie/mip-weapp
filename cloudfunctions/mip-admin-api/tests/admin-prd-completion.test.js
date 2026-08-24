'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const { createAdminRepository: createProductionAdminRepository } = require('../domain/repository')
const { createAdminService } = require('../domain/service')
const { withTestAuthorization } = require('./test-authorization')

const LEVEL_ID = '10000000-0000-4000-8000-000000000001'

function createAdminRepository(database) {
  return createProductionAdminRepository(database, withTestAuthorization())
}

function database({ one = async () => null, query = async () => [] } = {}) {
  return {
    one,
    query,
    async transaction(work) {
      return work({ one, query })
    },
  }
}

describe('admin PRD query completion', () => {
  it('returns and filters user level, cumulative experience and registration time from server facts', async () => {
    let captured
    const repository = createAdminRepository(database({
      async query(sql, params) {
        captured = { sql, params }
        return [{
          id: 'user-a', status: 'ACTIVE', primary_branch_id: 'branch-a', user_version: 2,
          nickname: '用户', headline: '', introduction: '', visibility_json: '{}', profile_version: 1,
          phone_ciphertext: null, phone_verified_at: null, branch_name: '广州分会', city_name: '广州',
          current_level_id: LEVEL_ID, level_name: '二级', experience_balance: 120,
          controls: null, is_player: 1,
          created_at: new Date('2026-08-01T00:00:00.000Z'),
          updated_at: new Date('2026-08-24T00:00:00.000Z'),
        }]
      },
    }))
    const page = await repository.listUsers(
      'wx-app',
      { platform: true, branchIds: [], eventIds: [] },
      {
        levelId: LEVEL_ID, experienceMin: 100, experienceMax: 200,
        createdFrom: '2026-08-01 00:00:00.000', createdTo: '2026-08-24 23:59:59.999',
      },
      20,
    )

    assert.match(captured.sql, /LEFT JOIN mip_growth_accounts ga/)
    assert.match(captured.sql, /LEFT JOIN mip_growth_levels gl/)
    assert.match(captured.sql, /ga\.current_level_id = \?/)
    assert.match(captured.sql, /COALESCE\(ga\.experience_balance, 0\) >= \?/)
    assert.match(captured.sql, /u\.created_at >= \?/)
    assert.ok(captured.params.includes(LEVEL_ID))
    assert.equal(page.items[0].levelId, LEVEL_ID)
    assert.equal(page.items[0].levelName, '二级')
    assert.equal(page.items[0].experience, 120)
    assert.equal(page.items[0].createdAt, '2026-08-01T00:00:00.000Z')
  })

  it('validates cumulative-experience and registration-time user filters before querying', async () => {
    const captured = []
    const repository = {
      resolveUser: async () => ({
        id: 'admin-user', status: 'ACTIVE', agreementsAccepted: true, phoneBound: true, profileComplete: true,
      }),
      listRoleBindings: async () => [{ roleKey: 'PLATFORM_OPERATIONS', scopeType: 'PLATFORM', scopeId: null }],
      listUsers: async (...args) => { captured.push(args); return [] },
    }
    const service = createAdminService({ repository, phoneEncryptionKey: '' })
    await service.listUsers({ appId: 'wx-app' }, { filters: {
      experienceMin: '100', experienceMax: 200,
      createdFrom: '2026-08-01T00:00:00.000Z', createdTo: '2026-08-24T23:59:59.999Z',
    } })
    assert.equal(captured[0][2].experienceMin, 100)
    assert.equal(captured[0][2].experienceMax, 200)
    assert.equal(captured[0][2].createdFrom, '2026-08-01 00:00:00.000')
    assert.equal(captured[0][2].createdTo, '2026-08-24 23:59:59.999')

    await assert.rejects(
      () => service.listUsers({ appId: 'wx-app' }, { filters: { experienceMin: 201, experienceMax: 200 } }),
      error => error.code === 'VALIDATION_FAILED',
    )
    await assert.rejects(
      () => service.listUsers({ appId: 'wx-app' }, { filters: {
        createdFrom: '2026-08-25T00:00:00.000Z', createdTo: '2026-08-24T00:00:00.000Z',
      } }),
      error => error.code === 'VALIDATION_FAILED',
    )
    assert.equal(captured.length, 1)
  })

  it('calculates event, membership, refund and net amounts over the exact authorized filters', async () => {
    let captured
    const repository = createAdminRepository(database({
      async one(sql, params) {
        captured = { sql, params }
        return {
          order_count: 4,
          paid_order_count: 3,
          event_gross_amount: 30000,
          membership_gross_amount: 79900,
          gross_amount: 109900,
          refunded_amount: 9900,
        }
      },
    }))
    const summary = await repository.summarizeOrders(
      'wx-app',
      { platform: true, branchIds: [], eventIds: [] },
      {
        query: '用户', orderType: 'EVENT', status: 'PAID', refundStatus: '', eventId: '',
        createdFrom: '2026-08-01 00:00:00.000', createdTo: '2026-08-24 23:59:59.999',
      },
    )

    assert.match(captured.sql, /o\.paid_at IS NOT NULL AND o\.order_type = 'EVENT'/)
    assert.match(captured.sql, /r\.status = 'SUCCEEDED'/)
    assert.match(captured.sql, /o\.order_type = \?/)
    assert.match(captured.sql, /o\.created_at >= \?/)
    assert.ok(captured.params.includes('%用户%'))
    assert.deepEqual(summary, {
      currency: 'CNY',
      orderCount: 4,
      paidOrderCount: 3,
      eventGrossAmountCents: 30000,
      membershipGrossAmountCents: 79900,
      grossAmountCents: 109900,
      refundedAmountCents: 9900,
      netAmountCents: 100000,
    })
  })

  it('queries opportunity publisher, city, time and complete detail without exposing owner ids', async () => {
    let captured
    const repository = createAdminRepository(database({
      async query(sql, params) {
        captured = { sql, params }
        return [{
          id: 'opportunity-a', title: '品牌合作', value_summary: '提供渠道', target_summary: '寻找设计团队',
          description: '合作详情', scope_type: 'BRANCH', branch_id: 'branch-a', branch_name: '广州分会',
          city_name: '广州', owner_nickname: '发布人', status: 'PUBLISHED', content_safety_status: 'APPROVED',
          referral_count: 2, version: 3, published_at: new Date('2026-08-20T00:00:00.000Z'),
          updated_at: new Date('2026-08-24T00:00:00.000Z'), moderated_at: null, moderation_reason: null,
          archived_at: null, archive_reason: null, role_keys: 'connector,visual_designer', tag_labels: '品牌,设计',
        }]
      },
    }))
    const page = await repository.listOpportunities(
      'wx-app',
      { platform: true, branchIds: [], eventIds: [] },
      {
        query: '合作', ownerQuery: '发布', cityQuery: '广州', status: 'PUBLISHED',
        updatedFrom: '2026-08-01 00:00:00.000', updatedTo: '2026-08-24 23:59:59.999',
      },
      20,
    )

    assert.match(captured.sql, /owner_profile\.nickname LIKE/)
    assert.match(captured.sql, /b\.city_name LIKE/)
    assert.match(captured.sql, /o\.updated_at >= \?/)
    assert.match(captured.sql, /mip_opportunity_roles/)
    assert.match(captured.sql, /mip_opportunity_tags/)
    assert.deepEqual(page.items[0].roleKeys, ['connector', 'visual_designer'])
    assert.deepEqual(page.items[0].tags, ['品牌', '设计'])
    assert.equal(page.items[0].ownerNickname, '发布人')
    assert.equal(page.items[0].description, '合作详情')
    assert.equal(Object.hasOwn(page.items[0], 'ownerUserId'), false)
  })

  it('normalizes opportunity filters before repository access', async () => {
    const captured = []
    const repository = {
      resolveUser: async () => ({
        id: 'admin-user', status: 'ACTIVE', agreementsAccepted: true, phoneBound: true, profileComplete: true,
      }),
      listRoleBindings: async () => [{ roleKey: 'PLATFORM_OPERATIONS', scopeType: 'PLATFORM', scopeId: null }],
      listOpportunities: async (...args) => { captured.push({ type: 'list', args }); return [] },
    }
    const service = createAdminService({ repository, phoneEncryptionKey: '' })
    const filters = {
      query: ' 合作 ', ownerQuery: ' 发布人 ', cityQuery: ' 广州 ', status: 'published',
      updatedFrom: '2026-08-01T00:00:00.000Z', updatedTo: '2026-08-24T23:59:59.999Z',
    }
    await service.listOpportunities({ appId: 'wx-app' }, { filters })
    const normalized = captured[0].args[2]
    assert.deepEqual(normalized, {
      query: '合作', ownerQuery: '发布人', cityQuery: '广州', status: 'PUBLISHED',
      updatedFrom: '2026-08-01 00:00:00.000', updatedTo: '2026-08-24 23:59:59.999',
      deadlineFrom: '', deadlineTo: '',
    })

    await assert.rejects(
      () => service.listOpportunities({ appId: 'wx-app' }, { filters: {
        updatedFrom: '2026-08-25T00:00:00.000Z', updatedTo: '2026-08-24T00:00:00.000Z',
      } }),
      error => error.code === 'VALIDATION_FAILED',
    )
    assert.equal(captured.filter(item => item.type === 'list').length, 1)
  })

  it('filters growth entries by source and creation time and returns the recorded time', async () => {
    let captured
    const repository = createAdminRepository(database({
      async query(sql, params) {
        captured = { sql, params }
        return [{
          id: 'entry-a', user_id: 'user-a', nickname: '用户', source_event_id: 'registration-a', source_event_type: 'event.checked_in',
          metric: 'EXPERIENCE', delta_value: 10, balance_after: 120, adjustment_reason: null,
          created_at: new Date('2026-08-20T12:00:00.000Z'),
        }]
      },
    }))
    const page = await repository.listGrowthEntries(
      'wx-app',
      { platform: true, branchIds: [], eventIds: [] },
      {
        userId: '', metric: 'EXPERIENCE', sourceEventType: 'event.checked_in',
        createdFrom: '2026-08-01 00:00:00.000', createdTo: '2026-08-24 23:59:59.999',
      },
      20,
    )

    assert.match(captured.sql, /ge\.source_event_type = \?/)
    assert.match(captured.sql, /ge\.created_at >= \?/)
    assert.match(captured.sql, /ge\.created_at <= \?/)
    assert.ok(captured.params.includes('event.checked_in'))
    assert.equal(page.items[0].sourceEventId, 'registration-a')
    assert.equal(page.items[0].balanceBefore, 110)
    assert.equal(page.items[0].createdAt, '2026-08-20T12:00:00.000Z')
  })

  it('normalizes growth source and time filters before repository access', async () => {
    const captured = []
    const repository = {
      resolveUser: async () => ({
        id: 'admin-user', status: 'ACTIVE', agreementsAccepted: true, phoneBound: true, profileComplete: true,
      }),
      listRoleBindings: async () => [{ roleKey: 'PLATFORM_OPERATIONS', scopeType: 'PLATFORM', scopeId: null }],
      listGrowthEntries: async (...args) => { captured.push(args); return [] },
    }
    const service = createAdminService({ repository, phoneEncryptionKey: '' })
    await service.listGrowthEntries({ appId: 'wx-app' }, { filters: {
      metric: 'EXPERIENCE', sourceEventType: ' event.checked_in ',
      createdFrom: '2026-08-01T00:00:00.000Z', createdTo: '2026-08-24T23:59:59.999Z',
    } })
    assert.deepEqual(captured[0][2], {
      userId: '', metric: 'EXPERIENCE', sourceEventType: 'event.checked_in',
      createdFrom: '2026-08-01 00:00:00.000', createdTo: '2026-08-24 23:59:59.999',
    })

    await assert.rejects(
      () => service.listGrowthEntries({ appId: 'wx-app' }, { filters: {
        createdFrom: '2026-08-25T00:00:00.000Z', createdTo: '2026-08-24T00:00:00.000Z',
      } }),
      error => error.code === 'VALIDATION_FAILED',
    )
    assert.equal(captured.length, 1)
  })

  it('uses the same validated registration-time filters for roster list and export queries', async () => {
    let captured
    const repository = createAdminRepository(database({
      async query(sql, params) {
        captured = { sql, params }
        return []
      },
    }))
    await repository.listRoster('wx-app', 'event-a', {
      query: '', status: '', createdFrom: '2026-08-01 00:00:00.000', createdTo: '2026-08-24 23:59:59.999',
    }, 20)
    assert.match(captured.sql, /r\.created_at >= \?/)
    assert.match(captured.sql, /r\.created_at <= \?/)
    assert.ok(captured.params.includes('2026-08-01 00:00:00.000'))

    const serviceCalls = []
    const service = createAdminService({
      phoneEncryptionKey: '',
      repository: {
        resolveUser: async () => ({
          id: 'admin-user', status: 'ACTIVE', agreementsAccepted: true, phoneBound: true, profileComplete: true,
        }),
        listRoleBindings: async () => [{ roleKey: 'PLATFORM_OPERATIONS', scopeType: 'PLATFORM', scopeId: null }],
        getEventScope: async () => ({ id: 'event-a', scopeType: 'PLATFORM', scopeId: null }),
        listRoster: async (...args) => { serviceCalls.push(args); return [] },
        writeAudit: async () => {},
      },
    })
    await service.listRoster({ appId: 'wx-app' }, {
      eventId: 'event-a',
      filters: { createdFrom: '2026-08-01T00:00:00.000Z', createdTo: '2026-08-24T23:59:59.999Z' },
    })
    assert.deepEqual(serviceCalls[0][2], {
      query: '', status: '', createdFrom: '2026-08-01 00:00:00.000', createdTo: '2026-08-24 23:59:59.999',
    })
    await assert.rejects(
      () => service.listRoster({ appId: 'wx-app' }, {
        eventId: 'event-a',
        filters: { createdFrom: '2026-08-25T00:00:00.000Z', createdTo: '2026-08-24T00:00:00.000Z' },
      }),
      error => error.code === 'VALIDATION_FAILED',
    )
    assert.equal(serviceCalls.length, 1)
  })

})
