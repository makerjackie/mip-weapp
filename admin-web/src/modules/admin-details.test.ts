import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { loadAdminDetail, type AdminDetailRequest } from './admin-details.ts'

function requestWith(responses: Record<string, unknown>, calls: Array<{ action: string; input: unknown }>): AdminDetailRequest {
  return async <T>(action: string, input = {}) => {
    calls.push({ action, input })
    return responses[action] as T
  }
}

describe('admin detail views', () => {
  it('projects the server user detail without requesting private phone data', async () => {
    const calls: Array<{ action: string; input: unknown }> = []
    const detail = await loadAdminDetail('users', 'user-1', requestWith({
      'mip.admin.users.get': {
        id: 'user-1', nickname: '林晓', kind: 'PLAYER', status: 'ACTIVE', phoneBound: true,
        branchName: '福田分会', cityName: '深圳', headline: '品牌顾问', introduction: '专注品牌策略',
        createdAt: '2030-01-01T00:00:00.000Z',
        membership: { status: 'ACTIVE', startsAt: '2030-01-01T00:00:00.000Z', endsAt: '2031-01-01T00:00:00.000Z' },
        growth: { levelName: 'L2', experience: 120, contribution: 30, coin: 18 },
        counts: { registrations: 4, attended: 3, orders: 2, opportunities: 1, cooperationCards: 2, superCases: 1 },
        influence: { guestCount: 2, interactionCount: 5, interestCount: 1, visitorCount: 8 },
        companies: [{ name: '远岸咨询', role: '顾问' }], organizations: [], tags: [], roles: [],
      },
      'mip.admin.memberships.get': { chainVersion: 3, membership: { status: 'ACTIVE' } },
    }, calls))

    assert.deepEqual(calls, [
      { action: 'mip.admin.users.get', input: { userId: 'user-1', includePhone: false } },
      { action: 'mip.admin.memberships.get', input: { userId: 'user-1' } },
    ])
    assert.equal(detail.title, '林晓')
    assert.equal(detail.status, '玩家')
    assert.equal(detail.sections.find(section => section.title === '基本信息')?.fields?.find(item => item.label === '手机状态')?.value, '已绑定')
    assert.equal(detail.sections.find(section => section.title === '会员权益')?.fields?.find(item => item.label === '会员链版本')?.value, '3')
    assert.equal(detail.sections.find(section => section.title === '业务记录')?.metrics?.find(item => item.label === '订单')?.value, '2')
  })

  it('does not request membership detail when the session lacks membership read access', async () => {
    const calls: Array<{ action: string; input: unknown }> = []
    const detail = await loadAdminDetail('users', 'user-1', requestWith({
      'mip.admin.users.get': { id: 'user-1', nickname: '林晓', kind: 'PLAYER', status: 'ACTIVE' },
    }, calls), { includeUserMembership: false })

    assert.deepEqual(calls.map(call => call.action), ['mip.admin.users.get'])
    assert.equal(detail.title, '林晓')
  })

  it('aggregates event detail, insights and roster from their read actions', async () => {
    const calls: Array<{ action: string; input: unknown }> = []
    const detail = await loadAdminDetail('events', 'event-1', requestWith({
      'mip.admin.events.get': {
        id: 'event-1', title: 'MIP 早会', summary: '活动摘要', description: '活动说明', notices: '提前签到',
        eventMode: 'OFFLINE', accessType: 'PAID', priceCents: 18800,
        startsAt: '2030-03-14T02:00:00.000Z', endsAt: '2030-03-14T04:00:00.000Z',
        registrationDeadline: null, cancellationDeadline: null, venueName: '福田会场', address: '福华三路', cityName: '深圳', status: 'PUBLISHED',
      },
      'mip.admin.events.insights.get': {
        eventId: 'event-1',
        participation: { effectiveRegistrationCount: 36, checkedInCount: 24, checkInRateBasisPoints: 6667, pendingReviewCount: 2, waitlistedCount: 1 },
        invitations: { attributedRegistrationCount: 8, distinctInviterCount: 5 },
        composition: { playerCount: 30, guestCount: 6 },
        hearts: { voterCount: 12, activeVoteCount: 10, mutualMatchCount: 3 },
        feedback: { access: 'RESTRICTED' },
        financials: { access: 'GRANTED', currency: 'CNY', paidOrderCount: 6, grossAmountCents: 112800, refundedAmountCents: 18800, netAmountCents: 94000 },
      },
      'mip.admin.events.roster': {
        items: [{ id: 'registration-1', version: 2, nickname: '周宁', cityName: '深圳', phoneBound: true, submittedAt: '2030-03-01T00:00:00.000Z', checkedInAt: null, status: 'REGISTERED' }],
        nextCursor: 'roster-cursor-3',
      },
      'mip.admin.events.album.list': {
        items: [{ id: 'photo-1', version: 3, nickname: '林晓', caption: '活动合影', createdAt: '2030-03-14T04:00:00.000Z', status: 'PENDING' }],
        nextCursor: null,
      },
    }, calls), { includeEventAlbum: true, eventRoster: { cursor: 'roster-cursor-2', limit: 10 } })

    assert.deepEqual(calls.map(call => call.action), [
      'mip.admin.events.get', 'mip.admin.events.insights.get', 'mip.admin.events.roster',
      'mip.admin.events.album.list',
    ])
    assert.deepEqual(calls[2].input, { eventId: 'event-1', includePhone: false, limit: 10, cursor: 'roster-cursor-2' })
    assert.deepEqual(calls[3].input, { eventId: 'event-1', status: 'PENDING', limit: 20 })
    assert.equal(detail.sections.find(section => section.title === '活动信息')?.fields?.find(item => item.label === '价格')?.value, '¥188.00')
    assert.equal(detail.sections.find(section => section.title === '参与情况')?.metrics?.find(item => item.label === '签到率')?.value, '66.67%')
    const registration = detail.sections.find(section => section.title.startsWith('报名名单'))?.rows?.[0]
    assert.equal(registration?.state, '已报名')
    assert.deepEqual(registration?.rowActions, [{
      action: 'mip.admin.events.checkIn', label: '签到', targetId: 'event-1',
      values: { eventId: 'event-1', registrationId: 'registration-1', expectedVersion: 2 },
    }])
    assert.deepEqual(detail.sections.find(section => section.title === '报名名单')?.pager, {
      key: 'eventRoster', query: '', currentCursor: 'roster-cursor-2', nextCursor: 'roster-cursor-3', placeholder: '报名名单',
    })
    const photo = detail.sections.find(section => section.title === '待审核相册')?.rows?.[0]
    assert.equal(photo?.caption, '活动合影')
    assert.equal(photo?.rowActions?.[0]?.action, 'mip.admin.events.album.review')
  })

  it('loads order detail before querying payment attempts by the exact order id', async () => {
    const calls: Array<{ action: string; input: unknown }> = []
    const detail = await loadAdminDetail('orders', 'order-1', requestWith({
      'mip.admin.orders.get': {
        order: {
          id: 'order-1', merchantOrderNoMasked: 'MIP…0001', resourceTitle: '年度会员', orderType: 'MEMBERSHIP',
          amountCents: 600000, refundedAmountCents: 0, currency: 'CNY', status: 'PAID', refundStatus: null,
          paidAt: '2030-02-01T00:00:00.000Z', createdAt: '2030-02-01T00:00:00.000Z', updatedAt: '2030-02-01T00:01:00.000Z',
        },
        buyer: { nickname: '林晓', kind: 'PLAYER', accountStatus: 'ACTIVE', branchName: '福田分会', cityName: '深圳' },
        product: { resourceType: 'MEMBERSHIP_PLAN', title: '年度会员', branchName: '', snapshot: { durationDays: 365, unlockDays: null, refundPolicy: 'NON_REFUNDABLE', benefits: ['活动权益'] } },
        refunds: [], entitlementTimeline: [], statusTimeline: [],
      },
      'mip.admin.paymentAttempts.list': {
        items: [{ orderId: 'order-1', provider: 'WECHAT_PAY', providerPaymentIdMasked: 'WX…0001', amountCents: 600000, currency: 'CNY', createdAt: '2030-02-01T00:00:00.000Z', status: 'SUCCEEDED', requiresAttention: false }],
        nextCursor: null,
      },
    }, calls))

    assert.deepEqual(calls, [
      { action: 'mip.admin.orders.get', input: { orderId: 'order-1' } },
      { action: 'mip.admin.paymentAttempts.list', input: { filters: { query: 'order-1' }, limit: 20 } },
    ])
    assert.equal(detail.title, '年度会员')
    assert.equal(detail.sections.find(section => section.title === '订单信息')?.fields?.find(item => item.label === '金额')?.value, '¥6,000.00')
    assert.equal(detail.sections.find(section => section.title === '支付尝试')?.rows?.[0].state, '成功')
  })

  it('loads a message campaign and projects only read-only delivery facts', async () => {
    const calls: Array<{ action: string; input: unknown }> = []
    const detail = await loadAdminDetail('messages', 'campaign-1', requestWith({
      'mip.admin.messageCampaigns.get': {
        id: 'campaign-1', name: '早会提醒', title: '报名提醒', body: '请确认报名信息',
        scopeType: 'BRANCH', branchName: '福田分会', audienceType: 'ALL', recipientCount: 24,
        status: 'PUBLISHED', contentSafetyStatus: 'PASSED', version: 2,
        updatedAt: '2030-03-01T00:00:00.000Z', publishedAt: '2030-03-01T00:00:00.000Z',
        deliveryStats: {
          submittedCount: 24, inboxReadyCount: 23, failedCount: 1,
          outboxStats: { pendingCount: 0, processingCount: 0, retryingCount: 1, deliveredCount: 23, terminalCount: 0 },
          externalTaskStats: { pendingCount: 1, processingCount: 0, retryingCount: 0, deliveredCount: 22, terminalCount: 1 },
        },
        activeDispatch: null,
      },
      'mip.admin.messageDeliveryReviews.list': {
        items: [{
          resourceRef: { type: 'CAMPAIGN_DISPATCH', id: 'dispatch-1' },
          evidence: { campaignRef: { type: 'MESSAGE_CAMPAIGN', id: 'campaign-1' } },
        }], nextCursor: null,
      },
      'mip.admin.messageDeliveryRecords.list': {
        items: [{ title: '报名提醒', nickname: '周宁', channel: 'WECHAT_SUBSCRIPTION', status: 'DELIVERED', attempts: 1, occurredAt: '2030-03-01T00:00:00.000Z', lastErrorCode: null }],
        nextCursor: null,
      },
      'mip.admin.messageDeliveryReviews.get': {
        resourceRef: { type: 'CAMPAIGN_DISPATCH', id: 'dispatch-1' },
        classification: 'SUCCEEDED', sourceState: { status: 'DELIVERED', attempts: 1, occurredAt: '2030-03-01T00:00:00.000Z', lastErrorCode: null },
        workflow: { status: 'RESOLVED' },
      },
    }, calls))

    assert.deepEqual(calls.map(call => call.action), [
      'mip.admin.messageCampaigns.get', 'mip.admin.messageDeliveryReviews.list',
      'mip.admin.messageDeliveryRecords.list', 'mip.admin.messageDeliveryReviews.get',
    ])
    assert.equal(detail.title, '报名提醒')
    assert.equal(detail.sections.find(section => section.title === '投递统计')?.metrics?.find(item => item.label === '已提交')?.value, '24')
    assert.equal(detail.sections.find(section => section.title.startsWith('投递记录'))?.rows?.[0].recipient, '周宁')
    assert.equal(detail.sections.find(section => section.title.startsWith('投递复核'))?.rows?.[0].classification, '成功')
  })

  it('keeps message detail usable without delivery review capability', async () => {
    const calls: Array<{ action: string; input: unknown }> = []
    const detail = await loadAdminDetail('messages', 'campaign-1', requestWith({
      'mip.admin.messageCampaigns.get': {
        id: 'campaign-1', title: '报名提醒', audienceType: 'ALL', recipientCount: 0,
        deliveryStats: {}, activeDispatch: null,
      },
      'mip.admin.messageDeliveryRecords.list': { items: [], nextCursor: null },
    }, calls), { includeMessageDeliveryReviews: false })

    assert.deepEqual(calls.map(call => call.action), [
      'mip.admin.messageCampaigns.get', 'mip.admin.messageDeliveryRecords.list',
    ])
    assert.equal(detail.sections.some(section => section.title.startsWith('投递复核')), false)
  })

  it('loads an opportunity with its own comments instead of a list-selected record', async () => {
    const calls: Array<{ action: string; input: unknown }> = []
    const detail = await loadAdminDetail('opportunities', 'opportunity-1', requestWith({
      'mip.admin.opportunities.get': {
        id: 'opportunity-1', title: '寻找品牌合作伙伴', ownerNickname: '林晓', scopeType: 'BRANCH',
        branchName: '福田分会', cityName: '深圳', valueSummary: '联合建设品牌', targetSummary: '完成首期合作',
        description: '面向消费品牌', roleKeys: ['strategist'], tags: ['品牌'], referralCount: 4,
        commercialTerms: { amountDisplay: '面议' }, deadlineAt: '2030-03-31T00:00:00.000Z', contentSafetyStatus: 'APPROVED',
        publishedAt: '2030-03-01T00:00:00.000Z', updatedAt: '2030-03-02T00:00:00.000Z', status: 'PUBLISHED',
        teamMembers: [{ nickname: '周宁', branchName: '福田分会' }],
        history: [{ action: 'admin.opportunities.publish', actorNickname: '运营账号', createdAt: '2030-03-01T00:00:00.000Z' }],
      },
      'mip.admin.opportunityComments.get': {
        settings: { commentsEnabled: true, reviewsEnabled: true, callsEnabled: false, moderationMode: 'REVIEW' },
        comments: [{ authorNickname: '周宁', type: 'COMMENT', body: '愿意沟通', rating: null, callCount: 2, createdAt: '2030-03-02T00:00:00.000Z', status: 'PUBLISHED' }],
        reports: [],
      },
    }, calls))

    assert.deepEqual(calls, [
      { action: 'mip.admin.opportunities.get', input: { opportunityId: 'opportunity-1' } },
      { action: 'mip.admin.opportunityComments.get', input: { opportunityId: 'opportunity-1' } },
    ])
    assert.equal(detail.title, '寻找品牌合作伙伴')
    assert.equal(detail.sections.find(section => section.title === '机会信息')?.fields?.find(item => item.label === '合作角色')?.value, '狗策划')
    assert.equal(detail.sections.find(section => section.title === '评论与评价')?.rows?.[0].body, '愿意沟通')
    assert.equal(detail.sections.find(section => section.title === '操作记录')?.rows?.[0].action, '发布机会')
  })

  it('loads a typed user-content detail from its composite list reference', async () => {
    const calls: Array<{ action: string; input: unknown }> = []
    const detail = await loadAdminDetail('userContent', 'COOPERATION_CARD:card-1', requestWith({
      'mip.admin.userContent.get': {
        id: 'card-1', kind: 'COOPERATION_CARD', status: 'PUBLISHED', contentSafetyStatus: 'APPROVED', version: 3,
        owner: { userId: 'user-1', nickname: '周宁', branchName: '福田分会', cityName: '深圳' },
        roleKey: 'connector', positioning: '链接产业资源', targetSummary: '寻找合作伙伴',
        roleFields: { circles: ['消费品牌'], resources: '渠道资源', target: '品牌合作' },
        abilityScores: { business_development: 4 }, moderationHistory: [],
        updatedAt: '2030-03-02T00:00:00.000Z', publishedAt: '2030-03-01T00:00:00.000Z',
      },
    }, calls))

    assert.deepEqual(calls, [{
      action: 'mip.admin.userContent.get', input: { kind: 'COOPERATION_CARD', contentId: 'card-1' },
    }])
    assert.equal(detail.route, 'userContent')
    assert.equal(detail.title, '链接产业资源')
    assert.equal(detail.source?.userContent && (detail.source.userContent as { version: number }).version, 3)
    assert.match(detail.sections.find(section => section.title === '合作卡内容')?.fields?.find(field => field.label === '角色信息')?.value || '', /品牌合作/)
  })

  it('loads knowledge content and keeps schedule data explicitly read-only', async () => {
    const calls: Array<{ action: string; input: unknown }> = []
    const detail = await loadAdminDetail('knowledge', 'content-1', requestWith({
      'mip.admin.knowledge.get': {
        id: 'content-1', title: '城市分会运营手册', summary: '运营参考', contentType: 'ARTICLE',
        authorName: 'MIP', category: { name: '运营' }, source: { name: '内部资料' }, accessType: 'MEMBER',
        status: 'PUBLISHED', contentSafetyStatus: 'PASSED', bodyText: '正文', externalUrl: '',
        commentsEnabled: true, moderationMode: 'AUTO', settingsVersion: 1,
        updatedAt: '2030-02-01T00:00:00.000Z', publishedAt: '2030-02-01T00:00:00.000Z', reviewedAt: null,
        product: { name: '运营手册', priceCents: 60000, currency: 'CNY', catalogStage: 'TEST', status: 'ACTIVE', unlockDays: 30, refundPolicy: 'BEFORE_ACCESS', refundWindowHours: 24 },
      },
      'mip.admin.knowledge.schedules.list': {
        items: [{ id: 'schedule-1', source: { name: '行业资讯', sourceType: 'RSS' }, category: { name: '运营' }, dailyTime: '08:00', timeZone: 'Asia/Shanghai', status: 'ACTIVE', nextRunAt: '2030-02-02T00:00:00.000Z', lastErrorCode: '' }],
        nextCursor: null,
      },
    }, calls))

    assert.deepEqual(calls, [
      { action: 'mip.admin.knowledge.get', input: { contentId: 'content-1' } },
      { action: 'mip.admin.knowledge.schedules.list', input: { limit: 20 } },
    ])
    assert.equal(detail.title, '城市分会运营手册')
    assert.equal(detail.sections.find(section => section.title === '内容信息')?.fields?.find(item => item.label === '正文')?.value, '正文')
    assert.equal(detail.sections.find(section => section.title.startsWith('知识库同步'))?.rows?.[0].source, '行业资讯')
  })
})
