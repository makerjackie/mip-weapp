import type { MembershipGateway, MembershipOrder, MembershipOverview, PaymentAdapter } from '../src/modules/membership/types'
import { describe, expect, it, vi } from 'vitest'
import { createMembershipModule } from '../src/modules/membership/module'

const overview: MembershipOverview = {
  plans: [],
  membership: { active: false, level: 'guest', expiresAt: null },
  profile: {
    nickname: '',
    avatarUrl: '',
    city: '',
    headline: '',
    bio: '',
    organization: '',
    roleTitle: '',
    industry: '',
    tags: [],
    interests: [],
    skills: [],
    phoneBound: false,
    completion: 0,
    onboardingComplete: false,
  },
  recommendations: [],
  events: [],
  unreadNotificationCount: 0,
  announcements: [],
}

function gateway(statuses: Array<'PENDING' | 'PAID'>) {
  let index = 0
  return {
    getOverview: vi.fn(async () => overview),
    listMembers: vi.fn(async () => overview.recommendations),
    listEvents: vi.fn(async () => ({ membershipActive: overview.membership.active, phoneBound: overview.profile.phoneBound, events: overview.events })),
    createCheckout: vi.fn(async () => ({ orderId: 'order-1' })),
    createPayment: vi.fn(async () => ({
      timeStamp: '1',
      nonceStr: 'nonce',
      package: 'prepay_id=1',
      signType: 'RSA' as const,
      paySign: 'signature',
    })),
    syncPayment: vi.fn(async () => ({ status: 'PAYMENT_CREATED' as const })),
    syncRefund: vi.fn(async () => ({ status: 'REFUND_CREATED' as const })),
    submitRefund: vi.fn(async () => ({ status: 'REFUND_CREATED' as const })),
    getOrder: vi.fn(async () => ({
      id: 'order-1',
      status: statuses[Math.min(index++, statuses.length - 1)],
      planId: 'test-10-cents',
      planName: '测试会员',
      description: '测试会员',
      durationDays: 1,
      amountCents: 10,
      createdAt: '2026-07-18T00:00:00.000Z',
      paidAt: null,
      entitlementStart: null,
      entitlementEnd: null,
      refundStatus: null,
      refundId: null,
    })),
    bindPhone: vi.fn(async () => overview.profile),
    uploadAvatar: vi.fn(async () => overview.profile),
    updateProfile: vi.fn(async () => overview.profile),
    registerEvent: vi.fn(async eventId => ({ kind: 'REGISTERED' as const, eventId, id: 'reg-1', status: 'REGISTERED' as const })),
    cancelRegistration: vi.fn(async eventId => ({
      eventId,
      id: 'reg-1',
      status: 'CANCELLED' as const,
      refundId: null,
      refundStatus: null,
    })),
    getMember: vi.fn(),
    setFollow: vi.fn(),
    listConnections: vi.fn(async () => []),
    listAnnouncements: vi.fn(async () => []),
    getAnnouncement: vi.fn(async () => ({
      id: 'announcement-1',
      title: '公告',
      summary: '摘要',
      body: '正文',
      isPinned: false,
      publishedAt: '',
    })),
    setMemberBlock: vi.fn(async (memberId, blocked) => ({ memberId, blocked })),
    listBlockedMembers: vi.fn(async () => []),
    reportMember: vi.fn(async () => ({ id: 'report-1', status: 'PENDING' as const, idempotent: false })),
    getEvent: vi.fn(),
    listEventParticipants: vi.fn(async eventId => ({
      eventId,
      eventTitle: '活动',
      totalRegistrationCount: 0,
      visibleParticipantCount: 0,
      roleFilters: [],
      items: [],
      nextCursor: null,
    })),
    listEventAlbum: vi.fn(async () => ({ items: [], nextCursor: null })),
    uploadEventPhoto: vi.fn(),
    deleteEventPhoto: vi.fn(),
    issueCheckInPass: vi.fn(),
    listOrders: vi.fn(async (): Promise<MembershipOrder[]> => []),
    listRegistrations: vi.fn(async () => []),
    listNotifications: vi.fn(async () => []),
    markNotificationsRead: vi.fn(async () => ({ updated: 0 })),
    recordNotificationSubscriptions: vi.fn(async () => ({ configured: 0, saved: 0, accepted: 0 })),
    requestAccountDeletion: vi.fn(async () => ({ status: 'DELETED' as const })),
  } satisfies MembershipGateway
}

describe('MembershipModule', () => {
  it('loads the real gateway overview through the module interface', async () => {
    const source = gateway(['PENDING'])
    const module = createMembershipModule(source, { request: vi.fn() }, { pollAttempts: 1 })
    await expect(module.load()).resolves.toEqual(overview)
    await expect(module.load()).resolves.toEqual(overview)
    expect(source.getOverview).toHaveBeenCalledOnce()
    expect(module.peekOverview()).toEqual(overview)
  })

  it('treats requestPayment acceptance as pending until the server order is paid', async () => {
    const payment: PaymentAdapter = { request: vi.fn(async () => 'accepted') }
    const module = createMembershipModule(gateway(['PENDING', 'PENDING']), payment, {
      pollAttempts: 2,
      pollIntervalMs: 0,
      paymentMode: 'test',
    })
    await expect(module.purchase('test-10-cents')).resolves.toMatchObject({ status: 'pending' })
  })

  it('does not poll or grant membership after user cancellation', async () => {
    const source = gateway(['PENDING'])
    const module = createMembershipModule(source, { request: vi.fn(async () => 'cancelled') }, {
      pollAttempts: 1,
      paymentMode: 'test',
    })
    await expect(module.purchase('test-10-cents')).resolves.toEqual({ status: 'cancelled' })
    expect(source.getOrder).not.toHaveBeenCalled()
  })

  it('reports paid only after the server order reaches PAID', async () => {
    const source = gateway(['PENDING', 'PAID'])
    const module = createMembershipModule(source, { request: vi.fn(async () => 'accepted') }, {
      pollAttempts: 2,
      pollIntervalMs: 0,
      paymentMode: 'test',
    })
    await expect(module.purchase('test-10-cents')).resolves.toMatchObject({ status: 'paid' })
    expect(source.getOrder).toHaveBeenCalledTimes(2)
  })

  it('routes profile and registration writes through the gateway seam', async () => {
    const source = gateway(['PENDING'])
    const module = createMembershipModule(source, { request: vi.fn() })
    await module.updateProfile({
      nickname: 'Jackie',
      city: '上海',
      headline: '独立开发者',
      bio: '正在做小产品。',
      organization: '01MVP',
      roleTitle: '产品负责人',
      industry: '软件',
      tags: ['AI'],
      interests: ['产品'],
      skills: ['小程序'],
    })
    await module.registerEvent('event-1', 2, { role: '开发者' }, true)
    await module.cancelRegistration('event-1')
    await module.requestAccountDeletion('DELETE')
    expect(source.updateProfile).toHaveBeenCalledOnce()
    expect(source.registerEvent).toHaveBeenCalledWith(
      'event-1',
      2,
      { role: '开发者' },
      true,
      expect.stringMatching(/^checkout-/),
    )
    expect(source.cancelRegistration).toHaveBeenCalledWith('event-1', '')
    expect(source.requestAccountDeletion).toHaveBeenCalledWith('DELETE')
  })

  it('routes filtered member and event feeds through the gateway seam', async () => {
    const source = gateway(['PENDING'])
    const module = createMembershipModule(source, { request: vi.fn() })
    await module.listMembers('same-city')
    await module.listEvents('mine')
    expect(source.listMembers).toHaveBeenCalledWith('same-city')
    expect(source.listEvents).toHaveBeenCalledWith('mine')
  })

  it('reconciles a pending provider refund before returning the order list', async () => {
    const source = gateway(['PENDING'])
    source.listOrders.mockResolvedValue([{
      id: 'order-1',
      status: 'REFUND_PENDING',
      planId: 'test-10-cents',
      planName: '测试会员',
      description: '测试会员',
      durationDays: 1,
      amountCents: 10,
      createdAt: '2026-07-18T00:00:00.000Z',
      paidAt: '2026-07-18T00:00:01.000Z',
      entitlementStart: null,
      entitlementEnd: null,
      refundStatus: 'REFUND_CREATED',
      refundId: 'refund-1',
    }])
    source.syncRefund.mockResolvedValue({ status: 'REFUND_CREATED' })
    const module = createMembershipModule(source, { request: vi.fn() })
    await module.reconcilePendingRefunds()
    expect(source.syncRefund).toHaveBeenCalledWith('refund-1')
  })
})
