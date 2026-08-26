'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const { CAPABILITIES } = require('../domain/capabilities')
const { createAdminBenefitLedger } = require('../domain/benefit-ledger')
const { createAdminRepository } = require('../domain/repository')
const { withTestAuthorization } = require('./test-authorization')

function repositoryWithRows(rows) {
  let querySql = ''
  let queryParams = []
  const database = {
    async query(sql, params) {
      querySql = sql
      queryParams = params
      return rows
    },
    async one() { return null },
    async transaction(work) { return work(this) },
  }
  return {
    repository: createAdminRepository(database, withTestAuthorization()),
    sql: () => querySql,
    params: () => queryParams,
  }
}

describe('admin unified benefit ledger projection', () => {
  it('rejects undeclared request and filter fields before repository access', async () => {
    let calls = 0
    const service = createAdminBenefitLedger({
      access: {
        async session() {
          return {
            caller: { appId: 'wx-app-a', userId: 'admin-a' },
            capabilities: [{ capability: CAPABILITIES.MEMBERSHIPS_READ }],
            bindings: [{ roleKey: 'PLATFORM_OWNER', scopeType: 'PLATFORM', scopeId: null }],
          }
        },
      },
      repository: {
        async listUnifiedBenefitLedger() {
          calls += 1
          return { items: [], nextCursor: null }
        },
      },
    })

    await assert.rejects(
      service.listUnifiedBenefitLedger({}, { filters: {}, extra: true }),
      error => error.code === 'VALIDATION_FAILED',
    )
    await assert.rejects(
      service.listUnifiedBenefitLedger({}, { filters: { extra: true } }),
      error => error.code === 'VALIDATION_FAILED',
    )
    assert.equal(calls, 0)
  })

  it('aggregates membership, growth entries and current growth benefits without exposing UUIDs', async () => {
    const { repository, sql } = repositoryWithRows([
      {
        source_id: 'membership-uuid', source_kind: 'MEMBERSHIP', nickname: '小明', player_number: 12,
        benefit_name: '年度会员', status: 'ACTIVE', starts_at: new Date('2026-01-01T00:00:00Z'),
        ends_at: new Date('2027-01-01T00:00:00Z'), occurred_at: new Date('2026-01-01T00:00:00Z'),
        source_type: 'ORDER', metric: null, delta_value: null, order_status: 'PAID',
        order_type: 'MEMBERSHIP', amount_cents: 9900, paid_at: new Date('2026-01-01T00:00:00Z'),
      },
      {
        source_id: 'growth-uuid', source_kind: 'GROWTH', nickname: '小明', player_number: 12,
        benefit_name: '完成活动', status: 'RECORDED', starts_at: null, ends_at: null,
        occurred_at: new Date('2026-01-02T00:00:00Z'), source_type: 'GROWTH_ENTRY', metric: 'EXPERIENCE',
        delta_value: 10, order_status: null, order_type: null, amount_cents: null, paid_at: null,
      },
    ])
    const result = await repository.listUnifiedBenefitLedger({
      appId: 'wx-app-a',
      membershipVisibility: { platform: true, branchIds: [], eventIds: [] },
      growthVisibility: { platform: true, branchIds: [], eventIds: [] },
      filters: { benefitType: '', query: '12', createdFrom: '', createdTo: '' },
      pageSize: 10,
      cursor: null,
    })

    assert.equal(result.items.length, 2)
    assert.equal(result.items[0].playerNumber, 12)
    assert.equal(result.items[0].order.orderType, 'MEMBERSHIP')
    assert.equal(Object.hasOwn(result.items[0], 'sourceId'), false)
    assert.match(sql(), /mip_membership_entitlements/)
    assert.match(sql(), /mip_growth_entries/)
    assert.match(sql(), /mip_growth_level_benefits/)
    assert.match(sql(), /mip_orders/)
    assert.match(sql(), /CAST\(projection\.player_number AS CHAR\)/)
    assert.match(sql(), /entitlement\.app_id = \?/)
  })

  it('binds the opaque source cursor to the stable projection ordering', async () => {
    const { repository, params } = repositoryWithRows([])
    await repository.listUnifiedBenefitLedger({
      appId: 'wx-app-a',
      membershipVisibility: { platform: true, branchIds: [], eventIds: [] },
      growthVisibility: { platform: true, branchIds: [], eventIds: [] },
      filters: { benefitType: '', query: '', createdFrom: '', createdTo: '' },
      pageSize: 10,
      cursor: { createdAt: '2026-01-02 00:00:00.000', sourceId: 'opaque-source' },
    })

    assert.equal(params().at(-2), 'opaque-source')
    assert.equal(params().at(-1), 11)
  })
})
