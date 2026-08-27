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

  it('loads opportunity content and matching facts without reusing the opportunity cursor', async () => {
    const calls: Array<{ action: string; input: unknown }> = []
    const page = await loadAdminReadPage('opportunities', { query: '', status: '', cursor: null, limit: 20 }, requestWith({
      'mip.admin.opportunities.list': { items: [{ id: 'opportunity-1', title: '寻找品牌合作伙伴', ownerNickname: '林晓', cityName: '深圳', branchName: '福田分会', targetSummary: '寻找联合创始人', roleKeys: ['DOG_PLANNER'], referralCount: 4, contentSafetyStatus: 'APPROVED', updatedAt: '2030-03-01T00:00:00.000Z', status: 'PUBLISHED' }], nextCursor: 'next' },
      'mip.admin.userContent.list': { items: [{ id: 'content-1', kind: 'COOPERATION_CARD', title: '产品合作卡', summary: '寻找产品合作机会', owner: { nickname: '周宁', cityName: '深圳', branchName: '福田分会' }, contentSafetyStatus: 'APPROVED', updatedAt: '2030-03-01T00:00:00.000Z', status: 'PUBLISHED' }], nextCursor: null },
      'mip.admin.matching.get': { settings: { scopeKey: 'PLATFORM', scopeType: 'PLATFORM', talentMinScore: 60, projectMinScore: 70, maximumCandidates: 10, externalProviderEnabled: false, version: 2, updatedAt: '2030-03-01T00:00:00.000Z' }, requests: [{ sourceOpportunity: { id: 'opportunity-1', title: '寻找品牌合作伙伴' }, requestedByType: 'ADMIN', provider: 'LOCAL', resultCount: 3, createdAt: '2030-03-01T00:00:00.000Z' }] },
    }, calls))

    assert.deepEqual(calls.map(call => call.action), ['mip.admin.opportunities.list', 'mip.admin.userContent.list', 'mip.admin.matching.get'])
    assert.deepEqual(calls[0].input, { cursor: undefined, limit: 20, filters: { query: '', status: '' } })
    assert.deepEqual(calls[1].input, { query: '', status: 'ALL', limit: 20 })
    assert.equal(page.sections.length, 4)
    assert.equal(page.sections[0].rows[0].referrals, '4')
    assert.equal(page.sections[0].rows[0].roles, '狗策划')
    assert.equal(page.sections[2].rows[0].provider, '仅本地服务')
    assert.equal(page.nextCursor, 'next')
  })

  it('loads growth, badge, and award read models through reviewed actions', async () => {
    const calls: Array<{ action: string; input: unknown }> = []
    const page = await loadAdminReadPage('growth', { query: '', status: '', cursor: null, limit: 20 }, requestWith({
      'mip.admin.growth.levels': { items: [{ name: '成长会员', levelKey: 'LEVEL_1', minimumExperience: 100, displayBadge: '资料完善', benefits: [{ name: '活动优先报名' }], legacyBenefits: [], currentUserCount: 20, currentUserPercentage: 50, version: 1, status: 'ACTIVE' }] },
      'mip.admin.growth.benefits': { items: [{ name: '活动优先报名', description: '优先报名活动', sortOrder: 1, version: 1, status: 'ACTIVE' }] },
      'mip.admin.growth.rules': { items: [{ name: '完成签到', metric: 'EXPERIENCE', deltaValue: 10, dailyLimitValue: 20, sourceEventType: 'event.checked_in', scopeType: 'PLATFORM', scopeId: null, effectiveFrom: null, effectiveTo: null, version: 1, status: 'ACTIVE' }] },
      'mip.admin.growth.entries': { items: [{ nickname: '林晓', metric: 'EXPERIENCE', deltaValue: 10, balanceBefore: 20, balanceAfter: 30, sourceEventType: 'event.checked_in', adjustmentReason: '', createdAt: '2030-03-01T00:00:00.000Z' }] },
      'mip.admin.growth.levelTransitions': { items: [{ nickname: '林晓', fromLevel: null, toLevel: { name: '成长会员' }, experienceBefore: 90, experienceAfter: 100, sourceEventType: 'event.checked_in', createdAt: '2030-03-01T00:00:00.000Z' }] },
      'mip.admin.badges.list': { items: [{ name: '资料完善', key: 'profile-complete', description: '完成资料', placeholderShape: 'HEXAGON', version: 1, updatedAt: '2030-03-01T00:00:00.000Z', status: 'ACTIVE' }] },
      'mip.admin.badges.awards': { items: [{ nickname: '林晓', badgeName: '资料完善', awardReason: '完成个人资料', awardedAt: '2030-03-01T00:00:00.000Z', equipped: true, status: 'ACTIVE' }] },
    }, calls))

    assert.deepEqual(calls.map(call => call.action), ['mip.admin.growth.levels', 'mip.admin.growth.benefits', 'mip.admin.growth.rules', 'mip.admin.growth.entries', 'mip.admin.growth.levelTransitions', 'mip.admin.badges.list', 'mip.admin.badges.awards'])
    assert.equal(page.sections.length, 7)
    assert.equal(page.sections[0].rows[0].benefits, '活动优先报名')
    assert.equal(page.sections[3].rows[0].balance, '20 → 30')
    assert.equal(page.sections[3].rows[0].source, '活动签到')
    assert.equal(page.sections[5].rows[0].shape, '六边形')
    assert.equal(page.sections[6].rows[0].reason, '完成个人资料')
  })

  it('loads operations records without deriving queue or moderation state in the browser', async () => {
    const calls: Array<{ action: string; input: unknown }> = []
    const report = { items: [{ category: 'SPAM', description: '重复发布', status: 'PENDING', reporter: { nickname: '陈默', cityName: '深圳' }, target: { nickname: '林晓', cityName: '深圳' }, updatedAt: '2030-03-01T00:00:00.000Z' }] }
    const page = await loadAdminReadPage('operations', { query: '', status: 'PENDING', cursor: null, limit: 20 }, requestWith({
      'mip.admin.announcements.list': { items: [] },
      'mip.admin.exceptions.list': { items: [] },
      'mip.admin.operations.queue.list': { items: [{ title: '投递待复核', source: 'DELIVERY_REVIEW', sourceType: 'DELIVERY_TASK', summary: '等待人工处理', reasonCode: 'TIMEOUT', occurredAt: '2030-03-01T00:00:00.000Z', state: 'PENDING' }] },
      'mip.admin.communityReports.list': report,
    }, calls))

    assert.deepEqual(calls.map(call => call.action), ['mip.admin.communityReports.list', 'mip.admin.announcements.list', 'mip.admin.exceptions.list', 'mip.admin.operations.queue.list'])
    assert.deepEqual(calls[0].input, { status: 'PENDING', limit: 20 })
    assert.equal(page.sections.length, 4)
    assert.equal(page.sections[1].rows[0].category, '垃圾信息')
    assert.equal(page.sections[3].rows[0].state, '待处理')
    assert.equal(page.sections[3].rows[0].reason, '处理超时')
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
