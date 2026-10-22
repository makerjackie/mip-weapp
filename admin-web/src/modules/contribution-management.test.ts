import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { contributionExportFilters, contributionManagement } from './contribution-management.ts'
import { loadAdminReadPage, type AdminRequest } from './admin-read-pages.ts'

describe('growth operations and ledger presentation', () => {
  it('reverses an original contribution through the reviewed action and preserves its idempotency key', async () => {
    const calls: Array<{ action: string; input: unknown }> = []
    const request: AdminRequest = async <T>(action: string, input: unknown) => { calls.push({ action, input }); return {} as T }
    await contributionManagement(request).reverse('original-entry', 10, ' 修正重复奖励 ', 'same-key')
    assert.deepEqual(calls[0], { action: 'mip.admin.contribution.transactions.reverse', input: { originalTransactionNo: 'original-entry', reversalValue: 10, reason: '修正重复奖励', idempotencyKey: 'same-key' } })
    assert.throws(() => contributionManagement(request).reverse('original-entry', -10, '原因', 'same-key'), /正整数/)
    assert.equal(calls.length, 1)
  })
  it('exports the same contribution behavior, server and full date range through the shared ledger', () => {
    assert.deepEqual(contributionExportFilters({ section: 'contributionTransactions', behavior: 'EVENT_CHECKIN', serverId: 'server-2', userId: 'user-2', sinceTime: '2026-10-01', untilTime: '2026-10-22' }), {
      metric: 'CONTRIBUTION', sourceEventType: 'event.checked_in', serverId: 'server-2', userId: 'user-2', createdFrom: '2026-10-01', createdTo: '2026-10-22',
    })
  })
  it('keeps experience separate, displays real nicknames and links only verified source objects', async () => {
    const calls: Array<{ action: string; input: unknown }> = []
    const request: AdminRequest = async <T>(action: string, input: unknown) => {
      calls.push({ action, input }); return { items: [
        { id: 'entry-1', userId: 'user-1', nickname: '林晓', metric: 'EXPERIENCE', deltaValue: 20, balanceBefore: 10, balanceAfter: 30, sourceEventType: 'task.completed', sourceEventId: 'event-id', relatedResource: { kind: 'TASK_COMPLETION', id: 'completion-1' }, createdAt: '2026-10-22T02:00:00Z' },
        { id: 'entry-2', userId: 'user-2', nickname: '另一人', sourceEventType: 'task.completed', sourceEventId: 'unresolved-event-id', deltaValue: 5, balanceAfter: 5 },
      ], nextCursor: null } as T
    }
    const page = await loadAdminReadPage('growth', { query: '', status: '', limit: 20, cursor: null, filters: { section: 'entries', metric: 'CONTRIBUTION' } }, request)
    assert.deepEqual((calls[0].input as { filters: unknown }).filters, { query: '', metric: 'EXPERIENCE' })
    assert.equal(page.sections[0].rows[0].user, '林晓')
    assert.equal(page.sections[0].rows[0].source, '完成任务')
    assert.ok(page.sections[0].rows[0].detailLinks?.some(link => link.id === 'completion-1'))
    assert.ok(!page.sections[0].rows[1].detailLinks?.some(link => link.id === 'unresolved-event-id'))
    assert.equal(page.sections[0].columns.find(column => column.key === 'entryNo')?.format, 'identifier')
  })
  it('exposes only positive un-reversed amounts for reversal', async () => {
    const request: AdminRequest = async <T>() => ({ items: [
      { id: 'txn-1', txnNo: 'txn-1', userId: 'u', nickname: '昵称', behavior: 'ADMIN_ADJUSTMENT', deltaValue: 30, reversedValue: 10, adjustmentReason: '补发' },
      { id: 'txn-2', txnNo: 'txn-2', userId: 'u', nickname: '昵称', behavior: 'CONTRIBUTION_REVERSAL', deltaValue: -10, reversedValue: 0 },
    ] } as T)
    const page = await loadAdminReadPage('growth', { query: '', status: '', limit: 20, cursor: null, filters: { section: 'contributionTransactions' } }, request)
    assert.equal(page.sections[0].rows[0].behavior, '人工发放或调整')
    assert.equal(page.sections[0].rows[0].reversibleValue, 20)
    assert.equal(page.sections[0].rows[1].reversibleValue, 0)
    assert.ok(page.sections[0].rows[0].rowDetail)
  })
})
