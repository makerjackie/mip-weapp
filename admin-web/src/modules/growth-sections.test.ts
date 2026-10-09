import assert from 'node:assert/strict'
import { it } from 'node:test'
import { createRequire } from 'node:module'
import { loadGrowth } from './admin-read-special-pages.ts'
const require = createRequire(import.meta.url)
const { createMembershipRepository } = require('../../../cloudfunctions/mip-admin-api/domain/repositories/memberships.js')

it('round trips a nonempty approval repository DTO into the page and sends only supported queue filters', async () => {
  const backend = createMembershipRepository({ query: async () => [{
    approval_id: 'approval-a', user_id: 'user-a', user_status: 'ACTIVE', nickname: '林晓', player_number: 6,
    approval_status: 'PENDING', chain_version: 3, pending_entitlements: 1, order_id: 'order-a', order_status: 'PAID',
    order_amount_cents: 36500, order_currency: 'CNY', plan_name: '年度会员', order_paid_at: '2030-01-01T07:59:00Z',
    requested_at: '2030-01-01T08:00:00Z', created_at: '2030-01-01T08:00:00Z', updated_at: '2030-01-01T08:00:00Z',
  }] })
  const payload = await backend.listMembershipApprovals({ appId: 'test-app', pageLimit: 20 })
  const page = await loadGrowth({ query: '林', status: 'PENDING', limit: 20, cursor: 'next-page', filters: { section: 'membershipApprovals', metric: 'EXPERIENCE' } }, async (action, input) => {
    assert.equal(action, 'mip.admin.membershipApprovals.list')
    assert.deepEqual(input, { filters: { query: '林', status: 'PENDING' }, limit: 20, cursor: 'next-page' })
    return payload
  })
  assert.equal(page.sections[0].rows.length, 1)
  assert.equal(page.sections[0].rows[0].user, '林晓')
  assert.equal(page.sections[0].rows[0].playerNumber, '6')
  assert.equal(page.sections[0].rows[0].amount, '¥365.00')
  assert.equal(page.sections[0].rows[0].state, '待处理')
})
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
it('renders the first-join approval queue with a decide row action prefilled by the chain version', async () => {
  const payload = {
    items: [
      {
        id: 'approval-a', status: 'PENDING', requestedAt: '2030-01-01T08:00:00.000Z', createdAt: '2030-01-01T08:00:00.000Z', updatedAt: '2030-01-01T08:00:00.000Z',
        chainVersion: 3, pendingEntitlements: 1, decisionReason: null, decidedBy: null, decidedAt: null,
        user: { id: 'user-a', nickname: '林晓', playerNumber: 6 },
        order: { id: 'order-a', status: 'PAID', planName: '年度会员', amountCents: 36500, currency: 'CNY', paidAt: '2030-01-01T07:59:00.000Z' },
      },
      {
        id: 'approval-b', status: 'REJECTED', requestedAt: '2030-01-02T08:00:00.000Z', createdAt: '2030-01-02T08:00:00.000Z', updatedAt: '2030-01-03T08:00:00.000Z',
        chainVersion: 5, pendingEntitlements: 0, decisionReason: '线下支付未确认', decidedAt: '2030-01-03T08:00:00.000Z',
        decidedBy: { id: 'admin-a', nickname: '周宁' },
        user: { id: 'user-b', nickname: '陈青', playerNumber: 7 },
        order: { id: 'order-b', status: 'PAID', planName: '月度会员', amountCents: 3000, currency: 'CNY', paidAt: '2030-01-02T07:59:00.000Z' },
      },
    ],
    nextCursor: null,
  }
  const page = await loadGrowth({ query: '', status: '', cursor: null, limit: 20, filters: { section: 'membershipApprovals' } }, async () => payload as never)
  assert.equal(page.sections.length, 1)
  assert.equal(page.sections[0].title, '入会审核')
  const [pending, rejected] = page.sections[0].rows
  assert.equal(pending.plan, '年度会员'); assert.equal(pending.amount, '¥365.00')
  assert.equal(pending.state, '待处理'); assert.equal(pending.decision, '—')
  assert.deepEqual(pending.rowActions, [{
    action: 'mip.admin.membershipApprovals.decide',
    label: '审核', targetId: 'user-a',
    values: { expectedChainVersion: 3 }, allowedCapabilities: ['memberships.adjust'],
  }])
  assert.equal(rejected.decision, '驳回：线下支付未确认')
  assert.deepEqual(rejected.rowActions, [{
    action: 'mip.admin.membershipApprovals.decide',
    label: '复议', targetId: 'user-b',
    values: { expectedChainVersion: 5 }, allowedCapabilities: ['memberships.adjust'],
  }])
  // 只读角色仍然能看到队列，但没有任何审核按钮。
  const readonly = await loadGrowth({ query: '', status: '', cursor: null, limit: 20, filters: { section: 'membershipApprovals' } }, async () => payload as never, { hasCapability: capability => capability === 'memberships.read' })
  assert.deepEqual(readonly.sections[0].rows[0].rowActions, [])
})
