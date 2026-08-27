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
    }, calls))

    assert.deepEqual(calls, [{ action: 'mip.admin.users.get', input: { userId: 'user-1', includePhone: false } }])
    assert.equal(detail.title, '林晓')
    assert.equal(detail.status, '玩家')
    assert.equal(detail.sections.find(section => section.title === '基本信息')?.fields?.find(item => item.label === '手机状态')?.value, '已绑定')
    assert.equal(detail.sections.find(section => section.title === '业务记录')?.metrics?.find(item => item.label === '订单')?.value, '2')
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
        items: [{ nickname: '周宁', cityName: '深圳', phoneBound: true, submittedAt: '2030-03-01T00:00:00.000Z', checkedInAt: null, status: 'REGISTERED' }],
        nextCursor: null,
      },
    }, calls))

    assert.deepEqual(calls.map(call => call.action), [
      'mip.admin.events.get', 'mip.admin.events.insights.get', 'mip.admin.events.roster',
    ])
    assert.deepEqual(calls[2].input, { eventId: 'event-1', includePhone: false, limit: 20 })
    assert.equal(detail.sections.find(section => section.title === '活动信息')?.fields?.find(item => item.label === '价格')?.value, '¥188.00')
    assert.equal(detail.sections.find(section => section.title === '参与情况')?.metrics?.find(item => item.label === '签到率')?.value, '66.67%')
    assert.equal(detail.sections.find(section => section.title.startsWith('报名名单'))?.rows?.[0].state, '已报名')
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
})
