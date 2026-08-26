'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const { CAPABILITIES, roleCapabilities } = require('../domain/capabilities')
const { createAdminUserContentRepository } = require('../domain/repositories/user-content')
const { createAdminUserContentGovernance } = require('../domain/user-content-governance')

const APP_ID = 'wx-app'
const USER_ID = '10000000-0000-4000-8000-000000000001'
const CONTENT_ID = '10000000-0000-4000-8000-000000000002'
const BRANCH_A = '10000000-0000-4000-8000-000000000003'
const BRANCH_B = '10000000-0000-4000-8000-000000000004'

function accessFixture(binding) {
  return {
    session: async () => ({
      caller: { appId: APP_ID, userId: USER_ID },
      bindings: [binding],
    }),
    mutationAuthorization: (grant, capability) => ({ capability, effectiveGrant: grant }),
    audit: (context, grant, input) => ({
      appId: context.caller.appId,
      actorUserId: context.caller.userId,
      effectiveRole: grant.roleKey,
      ...input,
    }),
  }
}

describe('admin user content governance service', () => {
  it('grants only platform operations and branch administrators the dedicated capability', () => {
    assert.equal(roleCapabilities.PLATFORM_OPERATIONS.includes(CAPABILITIES.USER_CONTENT_MODERATE), true)
    assert.equal(roleCapabilities.BRANCH_ADMIN.includes(CAPABILITIES.USER_CONTENT_MODERATE), true)
    for (const role of ['PLATFORM_FINANCE', 'EVENT_OWNER', 'EVENT_MANAGER', 'EVENT_STAFF']) {
      assert.equal(roleCapabilities[role].includes(CAPABILITIES.USER_CONTENT_MODERATE), false)
    }
  })

  it('lists only through capability-scoped branch visibility and normalizes filters', async () => {
    let captured
    const service = createAdminUserContentGovernance({
      access: accessFixture({ roleKey: 'BRANCH_ADMIN', scopeType: 'BRANCH', scopeId: BRANCH_A }),
      repository: {
        async listUserContent(...args) {
          captured = args
          return { items: [], nextCursor: null }
        },
      },
    })
    const result = await service.listUserContent({ appId: APP_ID }, {
      kind: 'COOPERATION_CARD',
      status: 'UNPUBLISHED',
      query: '  设计  ',
      limit: 100,
    })

    assert.deepEqual(result, { items: [], nextCursor: null })
    assert.equal(captured[0], APP_ID)
    assert.deepEqual(captured[1], { platform: false, branchIds: [BRANCH_A], eventIds: [] })
    assert.deepEqual(captured[2], {
      kind: 'COOPERATION_CARD',
      status: 'UNPUBLISHED',
      contentSafetyStatus: '',
      branchId: null,
      ownerUserId: null,
      roleKey: '',
      query: '设计',
      cursor: null,
    })
    assert.equal(captured[3], 50)
  })

  it('accepts the draft status used by the management editor list', async () => {
    let filters
    const service = createAdminUserContentGovernance({
      access: accessFixture({ roleKey: 'BRANCH_ADMIN', scopeType: 'BRANCH', scopeId: BRANCH_A }),
      repository: {
        async listUserContent(_appId, _visibility, normalized) {
          filters = normalized
          return { items: [], nextCursor: null }
        },
      },
    })

    await service.listUserContent({ appId: APP_ID }, { status: 'DRAFT' })
    assert.equal(filters.status, 'DRAFT')
  })

  it('requires a reason and sends a scoped, versioned, auditable unpublish intent', async () => {
    let captured
    const service = createAdminUserContentGovernance({
      access: accessFixture({ roleKey: 'BRANCH_ADMIN', scopeType: 'BRANCH', scopeId: BRANCH_A }),
      repository: {
        async getUserContentScope() {
          return {
            ownerUserId: USER_ID,
            scope: { scopeType: 'BRANCH', scopeId: BRANCH_A },
          }
        },
        async unpublishUserContent(input) {
          captured = input
          return { id: CONTENT_ID, kind: 'SUPER_CASE', status: 'UNPUBLISHED', version: 4 }
        },
      },
    })
    const result = await service.unpublishUserContent({ appId: APP_ID }, {
      kind: 'SUPER_CASE',
      contentId: CONTENT_ID,
      expectedVersion: 3,
      reason: '  内容信息已失效  ',
    })

    assert.deepEqual(result, { id: CONTENT_ID, kind: 'SUPER_CASE', status: 'UNPUBLISHED', version: 4 })
    assert.equal(captured.authorization.capability, CAPABILITIES.USER_CONTENT_MODERATE)
    assert.deepEqual(captured.authorizedScope, { scopeType: 'BRANCH', scopeId: BRANCH_A })
    assert.deepEqual(captured.audit(4), {
      appId: APP_ID,
      actorUserId: USER_ID,
      effectiveRole: 'BRANCH_ADMIN',
      scopeType: 'BRANCH',
      scopeId: BRANCH_A,
      action: 'admin.user_content.unpublish',
      resourceType: 'SUPER_CASE',
      resourceId: CONTENT_ID,
      metadata: { reason: '内容信息已失效', expectedVersion: 3, nextVersion: 4 },
    })
    await assert.rejects(
      service.unpublishUserContent({ appId: APP_ID }, {
        kind: 'SUPER_CASE', contentId: CONTENT_ID, expectedVersion: 3, reason: ' ',
      }),
      error => error.code === 'VALIDATION_FAILED',
    )
  })

  it('does not let a branch grant reach content owned by another current branch', async () => {
    const service = createAdminUserContentGovernance({
      access: accessFixture({ roleKey: 'BRANCH_ADMIN', scopeType: 'BRANCH', scopeId: BRANCH_A }),
      repository: {
        async getUserContentScope() {
          return {
            ownerUserId: USER_ID,
            scope: { scopeType: 'BRANCH', scopeId: BRANCH_B },
          }
        },
      },
    })
    await assert.rejects(
      service.unpublishUserContent({ appId: APP_ID }, {
        kind: 'COOPERATION_CARD', contentId: CONTENT_ID, expectedVersion: 1, reason: '信息失效',
      }),
      error => error.code === 'FORBIDDEN',
    )
  })

  it('requires an explicit visible owner and audits admin-created content', async () => {
    let captured
    const service = createAdminUserContentGovernance({
      access: accessFixture({ roleKey: 'BRANCH_ADMIN', scopeType: 'BRANCH', scopeId: BRANCH_A }),
      contentSafety: async () => 'APPROVED',
      repository: {
        async getUserContentOwnerScope() {
          return { ownerUserId: USER_ID, scope: { scopeType: 'BRANCH', scopeId: BRANCH_A } }
        },
        async saveUserContent(input) { captured = input; return { id: CONTENT_ID, kind: input.kind, status: 'PUBLISHED', version: 1 } },
      },
    })
    const result = await service.saveUserContent({ appId: APP_ID }, {
      kind: 'COOPERATION_CARD', ownerUserId: USER_ID,
      draft: {
        kind: 'COOPERATION_CARD', roleKey: 'connector', positioning: '渠道合作', targetSummary: '完成引荐',
        roleFields: { circles: ['企业服务'], resources: '客户资源', target: '完成引荐' },
        abilityScores: {
          business_development: 3, resource_integration: 3, capital_operation: 3,
          strategy_planning: 3, visual_design: 3, delivery_management: 3,
        }, status: 'PUBLISHED',
      },
    })
    assert.deepEqual(result, { id: CONTENT_ID, kind: 'COOPERATION_CARD', status: 'PUBLISHED', version: 1 })
    assert.equal(captured.ownerUserId, USER_ID)
    assert.deepEqual(captured.audit('id', 1, 'PUBLISHED').metadata, {
      ownerUserId: USER_ID, expectedVersion: 0, nextVersion: 1, status: 'PUBLISHED',
    })
  })
})

describe('admin user content governance repository', () => {
  it('returns an ever-published UNPUBLISHED detail for moderation review', async () => {
    let detailSql = ''
    const repository = createAdminUserContentRepository({
      async one(sql) {
        detailSql = sql
        return {
          id: CONTENT_ID,
          owner_user_id: USER_ID,
          role_key: 'connector',
          positioning: '区域渠道协作',
          target_summary: '完成 12 次有效引荐',
          role_fields_json: { circles: ['企业服务'], resources: '渠道资源' },
          ability_scores_json: { business_development: 5 },
          status: 'UNPUBLISHED',
          content_safety_status: 'APPROVED',
          version: 4,
          published_at: new Date('2030-01-01T00:00:00.000Z'),
          archived_at: null,
          updated_at: new Date('2030-01-03T00:00:00.000Z'),
          primary_branch_id: BRANCH_A,
          owner_nickname: '林然',
          branch_name: '深圳分会',
          city_name: '深圳',
        }
      },
      async query() { return [] },
    }, {
      assertMutationScope() {},
      async lockMutationAuthorization() {},
      async writeAudit() {},
    })

    const detail = await repository.getUserContent(
      APP_ID,
      { platform: true, branchIds: [], eventIds: [] },
      'COOPERATION_CARD',
      CONTENT_ID,
    )

    assert.equal(detail.status, 'UNPUBLISHED')
    assert.equal(detail.version, 4)
    assert.match(detailSql, /c\.published_at IS NOT NULL/)
    assert.doesNotMatch(detailSql, /c\.status\s*=\s*'PUBLISHED'/)
  })

  it('lists only ever-published rows and intersects the owner current branch', async () => {
    let query
    const repository = createAdminUserContentRepository({
      async query(sql, params) {
        query = { sql, params }
        return [{
          cursor_id: `1:${CONTENT_ID}`,
          id: CONTENT_ID,
          kind: 'COOPERATION_CARD',
          owner_user_id: USER_ID,
          owner_branch_id: BRANCH_A,
          owner_nickname: '林然',
          branch_name: '深圳分会',
          city_name: '深圳',
          title: '品牌视觉合作',
          summary: '寻找消费品牌项目',
          role_key: 'visual_designer',
          status: 'PUBLISHED',
          content_safety_status: 'APPROVED',
          version: 2,
          published_at: new Date('2030-01-01T00:00:00.000Z'),
          archived_at: null,
          updated_at: new Date('2030-01-02T00:00:00.000Z'),
        }]
      },
    }, {
      assertMutationScope() {},
      async lockMutationAuthorization() {},
      async writeAudit() {},
    })
    const page = await repository.listUserContent(APP_ID, {
      platform: false,
      branchIds: [BRANCH_A],
      eventIds: [],
    }, {
      kind: 'ALL',
      status: 'PUBLISHED',
      contentSafetyStatus: '',
      branchId: null,
      ownerUserId: null,
      roleKey: '',
      query: '',
      cursor: null,
    }, 20)

    assert.match(query.sql, /content\.published_at IS NOT NULL/)
    assert.match(query.sql, /content\.owner_branch_id IN \(\?\)/)
    assert.deepEqual(query.params.slice(0, 4), [APP_ID, APP_ID, 'PUBLISHED', BRANCH_A])
    assert.deepEqual(page.items[0], {
      id: CONTENT_ID,
      kind: 'COOPERATION_CARD',
      title: '品牌视觉合作',
      summary: '寻找消费品牌项目',
      roleKey: 'visual_designer',
      status: 'PUBLISHED',
      contentSafetyStatus: 'APPROVED',
      version: 2,
      owner: {
        userId: USER_ID,
        nickname: '林然',
        branchId: BRANCH_A,
        branchName: '深圳分会',
        cityName: '深圳',
      },
      publishedAt: '2030-01-01T00:00:00.000Z',
      archivedAt: null,
      updatedAt: '2030-01-02T00:00:00.000Z',
    })
  })

  it('locks authorization and author scope before a conditional soft unpublish and audit', async () => {
    const calls = []
    const tx = {
      async one(sql) {
        calls.push(['one', sql])
        return {
          owner_user_id: USER_ID,
          primary_branch_id: BRANCH_A,
          status: 'PUBLISHED',
          version: 3,
          published_at: new Date('2030-01-01T00:00:00.000Z'),
        }
      },
      async query(sql, params) {
        calls.push(['query', sql, params])
        return { affectedRows: 1 }
      },
    }
    const audits = []
    const repository = createAdminUserContentRepository({
      transaction: work => work(tx),
    }, {
      assertMutationScope(authorization, scope) {
        calls.push(['scope', authorization.capability, scope])
      },
      async lockMutationAuthorization(lockedTx, input) {
        calls.push(['authorization'])
        assert.equal(lockedTx, tx)
        assert.equal(input.authorization.capability, CAPABILITIES.USER_CONTENT_MODERATE)
        return input.authorization
      },
      async writeAudit(_tx, audit) {
        audits.push(audit)
      },
    })
    const result = await repository.unpublishUserContent({
      appId: APP_ID,
      actorUserId: USER_ID,
      kind: 'SUPER_CASE',
      contentId: CONTENT_ID,
      expectedVersion: 3,
      authorizedScope: { scopeType: 'BRANCH', scopeId: BRANCH_A },
      authorization: {
        capability: CAPABILITIES.USER_CONTENT_MODERATE,
        effectiveGrant: {
          roleKey: 'BRANCH_ADMIN',
          scopeType: 'BRANCH',
          scopeId: BRANCH_A,
        },
      },
      audit: nextVersion => ({ action: 'admin.user_content.unpublish', nextVersion }),
    })

    assert.equal(calls[0][0], 'authorization')
    assert.equal(calls[1][0], 'one')
    assert.match(calls[1][1], /FOR UPDATE/)
    assert.match(calls[1][1], /INNER JOIN mip_users u/)
    assert.match(calls[1][1], /u\.primary_branch_id/)
    assert.deepEqual(calls[2], [
      'scope',
      CAPABILITIES.USER_CONTENT_MODERATE,
      { scopeType: 'BRANCH', scopeId: BRANCH_A },
    ])
    assert.match(calls[3][1], /SET status = 'UNPUBLISHED', version = version \+ 1/)
    assert.deepEqual(audits, [{ action: 'admin.user_content.unpublish', nextVersion: 4 }])
    assert.deepEqual(result, {
      id: CONTENT_ID,
      kind: 'SUPER_CASE',
      status: 'UNPUBLISHED',
      version: 4,
    })
  })

  it('fails closed if the owner primary branch changed after authorization', async () => {
    const repository = createAdminUserContentRepository({
      transaction: work => work({
        async one() {
          return {
            owner_user_id: USER_ID,
            primary_branch_id: BRANCH_B,
            status: 'PUBLISHED',
            version: 3,
            published_at: new Date(),
          }
        },
      }),
    }, {
      assertMutationScope() {},
      async lockMutationAuthorization() { return { capability: CAPABILITIES.USER_CONTENT_MODERATE } },
      async writeAudit() {},
    })
    await assert.rejects(
      repository.unpublishUserContent({
        appId: APP_ID,
        actorUserId: USER_ID,
        kind: 'COOPERATION_CARD',
        contentId: CONTENT_ID,
        expectedVersion: 3,
        authorizedScope: { scopeType: 'BRANCH', scopeId: BRANCH_A },
        audit: () => ({}),
      }),
      error => error.code === 'CONFLICT',
    )
  })
})
