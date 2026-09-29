import assert from 'node:assert/strict'
import { it } from 'node:test'
import { loadGrowth } from './admin-read-special-pages.ts'
it('queries only the selected ledger, retains server pagination and does not filter an ID search out of the current page', async () => {
  const calls: unknown[] = []
  const page = await loadGrowth({ query: 'entry-a', status: '', cursor: 'cursor-a', limit: 20, filters: { section: 'entries', metric: 'EXPERIENCE', createdFrom: '2030-01-01T00:00:00Z' } }, async (action, input) => {
    calls.push({ action, input }); return { items: [{ id: 'entry-a', userId: 'user-a', nickname: '林', metric: 'EXPERIENCE', deltaValue: 2, balanceBefore: 0, balanceAfter: 2, sourceEventType: 'event.checked_in' }], nextCursor: 'cursor-b' } as never
  })
  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0], { action: 'mip.admin.growth.entries', input: { filters: { metric: 'EXPERIENCE', createdFrom: '2030-01-01T00:00:00Z', query: 'entry-a' }, limit: 20, cursor: 'cursor-a' } })
  assert.equal(page.sections[0].rows[0].user, '林')
  assert.equal(page.nextCursor, 'cursor-b')
})
it('keeps a failed section visible and never substitutes an empty-success result', async () => {
  const page = await loadGrowth({ query: '', status: '', cursor: null, limit: 20, filters: { section: 'contributionTransactions' } }, async () => { throw new Error('TEMPORARY_FAILURE') })
  assert.equal(page.sections.length, 1)
  assert.equal(page.sections[0].error, 'TEMPORARY_FAILURE')
})
it('does not fetch platform-only ledgers with a branch-scoped growth grant', async () => {
  let calls = 0
  const page = await loadGrowth({ query: '', status: '', cursor: null, limit: 20, filters: { section: 'entitlements' } }, async () => { calls++; throw new Error('FORBIDDEN') }, { hasCapability: (capability, scope) => capability === 'growth.read' && scope !== 'PLATFORM' })
  assert.equal(calls, 0)
  assert.equal(page.sections.length, 0)
})

it('renders actual serialized entitlement ledger content, grantor and order and keeps links capability-scoped', async () => {
  const { createRequire } = await import('node:module')
  const require = createRequire(import.meta.url)
  const { createGrowthOperationsRepository } = require('../../../cloudfunctions/mip-admin-api/domain/repositories/growth-operations.js')
  const calls: Array<{ sql: string; params: unknown[] }> = []
  const repository = createGrowthOperationsRepository({ query: async (sql: string, params: unknown[]) => { calls.push({ sql, params }); return [{ id: 'entitlement-a', user_id: 'user-a', nickname: '林晓', entitlement_type: 'MEMBERSHIP', amount: 365, months: 12, order_id: 'order-a', order_no: 'MIP20300101001', grantor: '周宁', source: 'MANUAL', starts_at: '2030-01-01T00:00:00Z', ends_at: '2031-01-01T00:00:00Z', granted_at: '2030-01-01T00:00:00Z' }] } })
  const payload = JSON.parse(JSON.stringify(await repository.listEntitlementTransactions({ appId: 'app-a', filters: { entitlementType: 'MEMBERSHIP', query: 'MIP20300101001', sinceTime: '2030-01-01', untilTime: '2030-01-31' }, limit: 20, cursor: null })))
  const query = { query: 'MIP20300101001', status: '', cursor: null, limit: 20, filters: { section: 'entitlements' } }
  const page = await loadGrowth(query, async () => payload)
  const row = page.sections[0].rows[0]
  assert.equal(row.content, '12 个月'); assert.equal(row.order, 'MIP20300101001'); assert.equal(row.grantor, '周宁')
  assert.deepEqual(row.detailLinks, [{ route: 'users', id: 'user-a', label: '用户档案' }, { route: 'orders', id: 'order-a', label: '关联订单' }])
  const readonly = await loadGrowth(query, async () => payload, { hasCapability: capability => capability === 'memberships.read' })
  assert.deepEqual(readonly.sections[0].rows[0].detailLinks, [])
  assert.match(calls[0].sql, /linked_order\.merchant_order_no AS order_no/)
  assert.doesNotMatch(calls[0].sql, /linked_order\.order_no/)
  assert.match(calls[0].sql, /ledger\.granted_at <= \?/)
  assert.equal(calls[0].params[0], 'app-a'); assert.equal(calls[0].params[1], 'app-a')
})
it('renders structured contribution limits and named servers rather than blank limits or raw identifiers', async () => {
  const page = await loadGrowth({ query: '', status: '', cursor: null, limit: 20, filters: { section: 'contributionRules' } }, async () => ({ items: [{ behavior: 'EVENT_CHECKIN', behaviorLabel: '参加活动及签到', rewardExp: 2, rewardLimit: { kind: 'PER_DAY', value: 3 }, scopeServers: ['branch-a'], scopeServerNames: ['深圳'], status: 'ACTIVE' }], nextCursor: null }) as never)
  assert.equal(page.sections[0].rows[0].rewardLimit, '每日最多 3'); assert.equal(page.sections[0].rows[0].scope, '深圳'); assert.equal(page.sections[0].rows[0].behavior, '参加活动及签到')
})
