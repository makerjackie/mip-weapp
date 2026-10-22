import assert from 'node:assert/strict'
import test from 'node:test'
import { auditActionLabel, auditResourceLabel } from './admin-read-formatters.ts'
import { loadAdminReadPage } from './admin-read-pages.ts'

test('audit labels describe known actions and keep unknown codes unmodified', () => {
  assert.equal(auditActionLabel('admin.paymentAttempts.view'), '支付记录 · 查看')
  assert.equal(auditActionLabel('admin.orders.detail.view'), '订单 · 详情 · 查看')
  assert.equal(auditActionLabel('admin.role_capability_policies.view'), '角色权限策略 · 查看')
  assert.equal(auditResourceLabel('ROLE_CAPABILITY_POLICY_LIST'), '角色权限策略列表')
  assert.equal(auditResourceLabel('NEW_UNKNOWN_LIST'), 'NEW_UNKNOWN_LIST')
})

test('audit table prefers an available object name and preserves raw fields in its detail', async () => {
  const id = '00000000-1111-2222-3333-444444444444'
  const page = await loadAdminReadPage('auditLogs', { query: '', status: '', cursor: null, limit: 20 }, async <T,>() => ({
    items: [
      { action: 'admin.orders.detail.view', resourceType: 'ORDER', resourceId: id, resourceName: '测试活动订单', actorNickname: '测试运营', createdAt: '2026-10-22T12:00:00Z' },
      { action: 'admin.paymentAttempts.view', resourceType: 'PAYMENT_ATTEMPT', resourceId: id },
    ], nextCursor: null,
  }) as T)
  assert.equal(page.sections[0].rows[0].resourceId, '测试活动订单')
  assert.equal(page.sections[0].rows[1].resourceId, '00000000…444444')
  const detail = page.sections[0].rows[0].rowDetail as { entries: { label: string; value: string }[] }
  assert.ok(detail.entries.some(entry => entry.label === '完整编号' && entry.value === id))
  assert.ok(detail.entries.some(entry => entry.label === '操作代码' && entry.value === 'admin.orders.detail.view'))
})
