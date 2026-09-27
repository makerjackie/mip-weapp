import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { batchIdempotencyKey, batchSummaryMessage, collectBatchTargets, executeBatchAction, mergeBatchInput } from './admin-batch-operations.ts'

const publishAction = 'mip.admin.announcements.publish' as const
const withdrawAction = 'mip.admin.announcements.withdraw' as const

describe('admin batch operations', () => {
  it('collects only rows that legally expose the action', () => {
    const rows = [
      { rowActions: [{ action: publishAction, label: '发布', values: { announcementId: 'a1', expectedVersion: 1 } }] },
      { rowActions: [{ action: withdrawAction, label: '撤回', values: { announcementId: 'a2', expectedVersion: 2 } }] },
      { rowActions: [] },
    ]
    const targets = collectBatchTargets(rows, publishAction)
    assert.equal(targets.length, 1)
    assert.deepEqual(targets[0].values, { announcementId: 'a1', expectedVersion: 1 })
  })

  it('lets shared batch values override per-row defaults', () => {
    const operation = { action: withdrawAction, label: '撤回', values: { announcementId: 'a1', expectedVersion: 3, reason: '' } } as const
    assert.deepEqual(mergeBatchInput(operation, { reason: '内容已过期' }), {
      announcementId: 'a1',
      expectedVersion: 3,
      reason: '内容已过期',
    })
  })

  it('runs each row independently and reports success, failure and skips', async () => {
    const rows = [
      { rowActions: [{ action: publishAction, label: '发布', values: { announcementId: 'ok-1', expectedVersion: 1 } }] },
      { rowActions: [{ action: publishAction, label: '发布', values: { announcementId: 'stale', expectedVersion: 1 } }] },
      { rowActions: [] },
    ]
    const keys: string[] = []
    const summary = await executeBatchAction(publishAction, rows, {}, async (_action, input) => {
      keys.push(String(input.idempotencyKey))
      if (input.announcementId === 'stale') throw new Error('VERSION_CONFLICT')
      return { ok: true }
    })

    assert.deepEqual(summary, { total: 3, succeeded: 1, failed: 1, skipped: 1 })
    assert.equal(keys.length, 2)
    assert.equal(new Set(keys).size, 2, 'each row needs its own idempotency key')
    assert.notEqual(batchSummaryMessage(summary).type, 'success')
  })

  it('reports a clean success message when nothing fails or skips', async () => {
    const rows = [
      { rowActions: [{ action: publishAction, label: '发布', values: { announcementId: 'a1', expectedVersion: 1 } }] },
    ]
    const summary = await executeBatchAction(publishAction, rows, {}, async () => ({}))
    assert.deepEqual(batchSummaryMessage(summary), { type: 'success', text: '已批量处理 1 条' })
  })

  it('builds bounded idempotency keys', () => {
    const key = batchIdempotencyKey('mip.admin.communityReports.close')
    assert.match(key, /^web-batch-close-/)
    assert.ok(key.length <= 128)
  })
})
