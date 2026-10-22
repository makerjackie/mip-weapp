import assert from 'node:assert/strict'
import test from 'node:test'
import { auditActionLabel, auditResourceLabel } from './admin-read-formatters.ts'
import { loadAdminReadPage } from './admin-read-pages.ts'

test('audit labels describe known actions and keep unknown codes unmodified', () => {
  assert.equal(auditActionLabel('admin.paymentAttempts.view'), '支付记录 · 查看')
  assert.equal(auditActionLabel('admin.orders.detail.view'), '订单 · 详情 · 查看')
  assert.equal(auditActionLabel('admin.role_capability_policies.view'), '角色权限策略 · 查看')
  assert.equal(auditActionLabel('admin.contribution.reverse'), '贡献值 · 冲正')
  assert.equal(auditActionLabel('admin.export.prepare'), '导出 · 准备')
  assert.equal(auditActionLabel('admin.export.phone.prepare'), '导出 · 手机号 · 准备')
  assert.equal(auditActionLabel('admin.opportunities.referrals.view'), '机会 · 引荐 · 查看')
  assert.equal(auditActionLabel('admin.NEW_UNKNOWN_ACTION'), 'NEW_UNKNOWN_ACTION')
  assert.equal(auditResourceLabel('GROWTH'), '成长')
  assert.equal(auditResourceLabel('EXPORT_TICKET'), '导出文件')
  assert.equal(auditResourceLabel('GROWTH_LEVEL'), '成长等级')
  assert.equal(auditResourceLabel('GROWTH_BENEFIT'), '等级权益')
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

test('new contribution, export and referral audit labels retain their original codes in details', async () => {
  const fixtures = [
    { action: 'admin.contribution.reverse', resourceType: 'GROWTH', actionLabel: '贡献值 · 冲正', resourceLabel: '成长' },
    { action: 'admin.export.prepare', resourceType: 'EXPORT_TICKET', actionLabel: '导出 · 准备', resourceLabel: '导出文件' },
    { action: 'admin.opportunities.referrals.view', resourceType: 'OPPORTUNITY', actionLabel: '机会 · 引荐 · 查看', resourceLabel: '机会' },
  ]
  const page = await loadAdminReadPage('auditLogs', { query: '', status: '', cursor: null, limit: 20 }, async <T,>() => ({ items: fixtures, nextCursor: null }) as T)
  for (const [index, fixture] of fixtures.entries()) {
    const row = page.sections[0].rows[index]
    assert.equal(row.action, fixture.actionLabel)
    assert.equal(row.resource, fixture.resourceLabel)
    const detail = row.rowDetail as { entries: { label: string; value: string }[] }
    assert.ok(detail.entries.some(entry => entry.label === '操作代码' && entry.value === fixture.action))
    assert.ok(detail.entries.some(entry => entry.label === '模块代码' && entry.value === fixture.resourceType))
  }
})
