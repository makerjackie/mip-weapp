import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  loadAdminReadPage,
  type AdminListQuery,
  type AdminRequest,
} from './admin-read-pages.ts'

const query: AdminListQuery = {
  query: '早会',
  status: 'PUBLISHED',
  cursor: 'next-cursor',
  limit: 20,
}

function requestWith(responses: Record<string, unknown>, calls: Array<{ action: string; input: unknown }>): AdminRequest {
  return async <T>(action: string, input = {}) => {
    calls.push({ action, input })
    return responses[action] as T
  }
}

describe('admin read pages', () => {
  it('loads and maps the event cursor page through the neutral action', async () => {
    const calls: Array<{ action: string; input: unknown }> = []
    const page = await loadAdminReadPage('events', query, requestWith({
      'mip.admin.events.list': {
        items: [{
          id: 'event-1', title: 'MIP 早会', startsAt: '2030-03-14T02:00:00.000Z', cityName: '深圳',
          branchName: '福田分会', accessType: 'PAID', priceCents: 18800,
          registrationCount: 36, capacity: 50, attendedCount: 12, status: 'PUBLISHED',
        }],
        nextCursor: 'third-page',
      },
    }, calls))

    assert.deepEqual(calls, [{
      action: 'mip.admin.events.list',
      input: {
        filters: { query: '早会', status: 'PUBLISHED' },
        cursor: 'next-cursor',
        limit: 20,
        sort: { field: 'startsAt', direction: 'DESC' },
      },
    }])
    assert.equal(page.nextCursor, 'third-page')
    assert.equal(page.sections[0].rows[0].detailId, 'event-1')
    assert.equal(page.sections[0].rows[0].title, 'MIP 早会')
    assert.equal(page.sections[0].rows[0].registrations, '36 / 50')
    assert.equal(page.sections[0].rows[0].state, '已发布')
  })

  it('keeps order summary and safe projected fields in the read model', async () => {
    const calls: Array<{ action: string; input: unknown }> = []
    const page = await loadAdminReadPage('orders', { ...query, query: 'MIP-001', status: 'PAID' }, requestWith({
      'mip.admin.orders.list': {
        items: [{
          merchantOrderNoMasked: 'MIP…0001', nickname: '林晓', orderType: 'EVENT',
          resourceTitle: 'MIP 早会', amountCents: 18800, currency: 'CNY',
          createdAt: '2030-03-01T01:00:00.000Z', status: 'PAID',
        }],
        nextCursor: null,
        summary: { orderCount: 3, paidOrderCount: 2, netAmountCents: 37600, refundedAmountCents: 0 },
      },
    }, calls))

    assert.equal(calls[0].action, 'mip.admin.orders.list')
    assert.equal(page.sections[0].rows[0].id, 'MIP…0001')
    assert.equal(page.sections[0].rows[0].amount, '¥188.00')
    assert.deepEqual(page.summary?.map(item => item.value), ['3', '2', '¥376.00', '¥0.00'])
  })

  it('loads roles, policy summaries, branches, and recent audit records without adding a browser-side permission rule', async () => {
    const calls: Array<{ action: string; input: unknown }> = []
    const page = await loadAdminReadPage('permissions', { ...query, query: '周宁', status: 'ACTIVE' }, requestWith({
      'mip.admin.roles.list': { items: [{ id: 'role-1', nickname: '周宁', roleKey: 'BRANCH_ADMIN', scopeName: '福田分会', status: 'ACTIVE', grantedAt: '2030-01-01T00:00:00.000Z' }], nextCursor: null },
      'mip.admin.branches.list': { items: [{ id: 'branch-1', name: '福田分会', branchKey: 'shenzhen-futian', cityName: '深圳', summary: '深圳福田城市分会', currentPlayerCount: 86, branchAdminNames: ['周宁'], blockers: { activeMemberships: 86, activeBranchAdmins: 1, publishedEvents: 3, publishedOpportunities: 2 }, status: 'ACTIVE' }], nextCursor: null },
      'mip.admin.rolePolicies.list': { items: [{ roleKey: 'BRANCH_ADMIN', scopeType: 'BRANCH', capabilities: ['events.read', 'events.write'], allowedCapabilities: ['events.read', 'events.write', 'branches.manage'], source: 'DEFAULT', version: 1, updatedAt: '2030-01-01T00:00:00.000Z' }], nextCursor: null },
      'mip.admin.audit.list': { items: [{ actorNickname: '周宁', action: 'admin.roles.grant', resourceType: 'ROLE', resourceId: 'role-1', effectiveRole: 'BRANCH_ADMIN', scopeType: 'BRANCH', scopeId: 'branch-1', createdAt: '2030-01-02T00:00:00.000Z' }], nextCursor: null },
    }, calls))

    assert.deepEqual(calls.map(call => call.action), ['mip.admin.roles.list', 'mip.admin.branches.list', 'mip.admin.rolePolicies.list', 'mip.admin.audit.list'])
    assert.deepEqual(calls.find(call => call.action === 'mip.admin.audit.list')?.input, { limit: 20 })
    assert.equal(page.sections.length, 4)
    assert.equal(page.sections[0].rows[0].role, '分会管理员')
    assert.equal(page.sections[1].title, '角色策略摘要')
    assert.equal(page.sections[1].rows[0].effective, '查看活动、管理活动')
    assert.equal(page.sections[2].rows[0].blockers, '会员 86 · 管理员 1 · 活动 3 · 机会 2')
    assert.equal(page.sections[3].title, '最近审计记录')
    assert.equal(page.sections[3].rows[0].action, '角色 · 授权')
    assert.equal(page.sections[3].rows[0].resource, '角色')
  })

  it('uses only the reviewed message campaign query for the message page', async () => {
    const calls: Array<{ action: string; input: unknown }> = []
    const page = await loadAdminReadPage('messages', query, requestWith({
      'mip.admin.messageCampaigns.list': {
        items: [{ id: 'campaign-1', title: '报名提醒', audienceType: 'EXPLICIT', recipientCount: 24, scopeType: 'BRANCH', branchName: '福田分会', updatedAt: '2030-03-01T00:00:00.000Z', status: 'READY' }],
        nextCursor: null,
      },
    }, calls))

    assert.deepEqual(calls, [{
      action: 'mip.admin.messageCampaigns.list',
      input: { query: '早会', status: 'PUBLISHED', limit: 20 },
    }])
    assert.equal(page.sections[0].rows[0].audience, '24 人')
    assert.equal(page.sections[0].rows[0].scope, '福田分会')
    assert.equal(page.sections[0].rows[0].detailId, 'campaign-1')
  })

  it('requests the knowledge content section and maps nested category data', async () => {
    const calls: Array<{ action: string; input: unknown }> = []
    const page = await loadAdminReadPage('knowledge', { ...query, query: '运营' }, requestWith({
      'mip.admin.knowledge.list': {
        section: 'CONTENTS',
        items: [{ id: 'content-1', title: '城市分会运营手册', contentType: 'ARTICLE', category: { name: '运营' }, authorName: 'MIP', accessType: 'MEMBER', updatedAt: '2030-02-01T00:00:00.000Z', status: 'PUBLISHED' }],
        nextCursor: null,
      },
    }, calls))

    assert.deepEqual(calls, [{
      action: 'mip.admin.knowledge.list',
      input: { section: 'CONTENTS', status: 'PUBLISHED', limit: 20 },
    }])
    assert.equal(page.sections[0].rows[0].category, '运营')
    assert.equal(page.sections[0].rows[0].access, '会员可见')
    assert.equal(page.sections[0].rows[0].detailId, 'content-1')
  })
})
