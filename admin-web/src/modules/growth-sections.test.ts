import assert from 'node:assert/strict'
import { it } from 'node:test'
import { createRequire } from 'node:module'
import { loadGrowth } from './admin-read-special-pages.ts'
import { isRecordDetail } from './admin-record-detail.ts'
import { dateRange } from './admin-read-formatters.ts'
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
    calls.push({ action, input }); return { items: [{ id: 'entry-a', userId: 'user-a', nickname: '林', metric: 'EXPERIENCE', deltaValue: 2, balanceAfter: 2, sourceEventType: 'event.checked_in', sourceEventId: 'transition-a' }], nextCursor: 'cursor-b' } as never
  })
  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0], { action: 'mip.admin.growth.entries', input: { filters: { metric: 'EXPERIENCE', createdFrom: '2030-01-01T00:00:00Z', query: 'entry-a' }, limit: 20, cursor: 'cursor-a' } })
  // 姓名优先展示；原始用户、流水和来源编号仍能从详情追溯。
  const row = page.sections[0].rows[0]
  assert.equal(row.entryNo, 'entry-a')
  assert.equal(row.user, '林')
  assert.equal(row.userId, 'user-a')
  assert.ok(isRecordDetail(row.rowDetail))
  for (const [label, value] of [['流水编号', 'entry-a'], ['用户编号', 'user-a'], ['来源代码', 'event.checked_in'], ['来源记录编号', 'transition-a']]) {
    assert.equal(row.rowDetail.entries.find(entry => entry.label === label)?.value, value)
  }
  assert.equal(page.sections[0].columns.find(column => column.key === 'entryNo')?.format, 'identifier')
  assert.equal(row.before, '0')
  assert.equal(row.after, '2')
  assert.equal(page.nextCursor, 'cursor-b')
})
it('renders the contribution ledger with behavior labels and related-business links for confirmed semantics', async () => {
  const taskRow = { txnNo: 'txn-a', userId: 'user-a', nickname: '林晓', behavior: 'TASK_COMPLETED', behaviorLabel: '完成 NPC 任务', deltaValue: 5, relatedBusiness: 'outbox-a', sourceEventType: 'task.completed', relatedResource: { kind: 'TASK_COMPLETION', id: 'completion-a' }, createdAt: '2030-03-01T00:00:00.000Z' }
  const page = await loadGrowth({ query: '', status: '', cursor: null, limit: 20, filters: { section: 'contributionTransactions' } }, async () => ({
    items: [
      taskRow,
      { txnNo: 'txn-b', userId: 'user-b', nickname: '陈默', behavior: 'EVENT_CHECKIN', behaviorLabel: '参加活动及签到', deltaValue: 2, relatedBusiness: 'transition-a', createdAt: '2030-03-02T00:00:00.000Z' },
    ],
    nextCursor: null,
  }) as never)
  const [assembledTaskRow, eventRow] = page.sections[0].rows
  assert.equal(page.sections[0].title, '贡献值流水')
  assert.deepEqual(page.sections[0].columns.map(column => column.label), ['用户', '行为', '变动值', '处理结果', '时间', '流水号'])
  assert.equal(page.sections[0].columns.find(column => column.key === 'txnNo')?.format, 'identifier')
  assert.equal(assembledTaskRow.txnNo, 'txn-a')
  assert.equal(assembledTaskRow.user, '林晓')
  assert.equal(assembledTaskRow.behavior, '完成 NPC 任务')
  assert.equal(assembledTaskRow.related, 'outbox-a')
  assert.ok(isRecordDetail(assembledTaskRow.rowDetail))
  for (const [label, value] of [['流水编号', 'txn-a'], ['用户编号', 'user-a'], ['来源代码', 'task.completed'], ['来源记录编号', 'outbox-a']]) {
    assert.equal(assembledTaskRow.rowDetail.entries.find(entry => entry.label === label)?.value, value)
  }
  assert.deepEqual(assembledTaskRow.detailLinks, [{ route: 'users', id: 'user-a', label: '用户档案' }, { route: 'taskCompletions', id: 'completion-a', label: '关联业务' }])
  // 未解析的来源编号保留，但不能冒充活动编号生成跳转。
  assert.equal(eventRow.related, 'transition-a')
  assert.deepEqual(eventRow.detailLinks, [{ route: 'users', id: 'user-b', label: '用户档案' }])
  const readonly = await loadGrowth({ query: '', status: '', cursor: null, limit: 20, filters: { section: 'contributionTransactions' } }, async () => ({ items: [taskRow], nextCursor: null }) as never, { hasCapability: capability => capability === 'growth.read' })
  assert.deepEqual(readonly.sections[0].rows[0].detailLinks, [])
  assert.ok(isRecordDetail(readonly.sections[0].rows[0].rowDetail))
  assert.equal(readonly.sections[0].rows[0].rowDetail.entries.find(entry => entry.label === '来源记录编号')?.value, 'outbox-a')
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
  // 用户列展示姓名，完整用户编号、流水号和有效期在详情中保留。
  assert.equal(row.user, '林晓')
  assert.equal(row.entitlementNo, 'entitlement-a')
  assert.ok(isRecordDetail(row.rowDetail))
  assert.equal(row.rowDetail.entries.find(entry => entry.label === '用户编号')?.value, 'user-a')
  assert.equal(row.rowDetail.entries.find(entry => entry.label === '流水编号')?.value, 'entitlement-a')
  assert.equal(row.rowDetail.entries.find(entry => entry.label === '关联订单')?.value, 'MIP20300101001')
  assert.equal(row.rowDetail.entries.find(entry => entry.label === '权益有效期')?.value, dateRange('2030-01-01T00:00:00Z', '2031-01-01T00:00:00Z'))
  assert.equal(row.type, '玩家会籍')
  assert.deepEqual(page.sections[0].columns.map(column => column.label), ['用户', '权益类型', '权益内容', '发放人', '发放时间', '关联订单号', '权益流水号'])
  assert.equal(page.sections[0].columns.find(column => column.key === 'entitlementNo')?.format, 'identifier')
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
