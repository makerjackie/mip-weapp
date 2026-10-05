import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const commerce = vi.hoisted(() => ({
  getOrder: vi.fn(),
  reconcile: vi.fn(),
  peekPlans: vi.fn(),
  getMembershipBenefits: vi.fn(),
}))
const identity = vi.hoisted(() => ({ loadSnapshot: vi.fn() }))

vi.mock('../src/modules/mip-commerce/client', () => ({ mipCommerceModule: commerce }))
vi.mock('../src/modules/mip-events/client', () => ({
  mipEventsModule: {},
  mipCheckInResumeStore: { peek: vi.fn() },
}))
vi.mock('../src/modules/mip-identity/client', () => ({ mipIdentityModule: identity }))
vi.mock('../src/modules/mip-messaging/client', () => ({ mipMessagingModule: {} }))
vi.mock('../src/platform/navigation/client', () => ({ caseNavigateTo: vi.fn() }))

interface PageDefinition {
  data: Record<string, unknown>
  [key: string]: unknown
}

let definition: PageDefinition

const membershipOrder = {
  id: 'order-m',
  userId: 'user-a',
  orderType: 'MEMBERSHIP',
  status: 'PAID',
  amountCents: 6600,
  currency: 'CNY',
  membershipPlanId: 'plan-a',
  createdAt: '2030-01-01T00:00:00.000Z',
} as Record<string, unknown>

beforeAll(async () => {
  vi.stubGlobal('Page', (value: PageDefinition) => {
    definition = value
  })
  await import('../src/packages/member/payment-result/index')
})

beforeEach(() => {
  vi.clearAllMocks()
  commerce.peekPlans.mockReturnValue([])
  commerce.reconcile.mockImplementation(async (orderId: string) => ({
    ...membershipOrder,
    id: orderId,
  }))
  identity.loadSnapshot.mockResolvedValue({
    membership: { kind: 'GUEST' },
  })
})

function page() {
  return Object.assign(Object.create(definition) as PageDefinition, {
    data: structuredClone(definition.data),
    setData(patch: Record<string, unknown>) { Object.assign(this.data, patch) },
  })
}

async function check(orderId: string) {
  const instance = page()
  instance.setData({ orderId })
  await Reflect.apply(definition.check, instance, [])
  return instance
}

describe('membership payment result under the first-join approval gate', () => {
  it('tells an approved member their benefits are live', async () => {
    commerce.getOrder.mockResolvedValue(membershipOrder)
    commerce.getMembershipBenefits.mockResolvedValue({
      kind: 'PLAYER',
      status: 'ACTIVE',
      membershipEndsAt: '2031-01-01T00:00:00.000Z',
    })

    const instance = await check('order-m')

    expect(instance.data.result).toBe('success')
    expect(instance.data.description).toBe('支付成功，会员权益已开通。')
    expect(commerce.getMembershipBenefits).toHaveBeenCalledWith({ force: true })
  })

  it('surfaces the admin approval wait instead of claiming the membership is live', async () => {
    commerce.getOrder.mockResolvedValue(membershipOrder)
    commerce.getMembershipBenefits.mockResolvedValue({
      kind: 'PENDING',
      status: 'PENDING',
      plan: { id: 'plan-a', name: '年度会员' },
    })

    const instance = await check('order-m')

    expect(instance.data.result).toBe('success')
    expect(instance.data.title).toBe('支付已确认')
    expect(instance.data.description).toBe('入会申请已提交，管理后台审核通过后会员权益生效。')
    // 审核中的会员还没有到期时间，不能展示虚构的有效期。
    expect(instance.data.membershipEndsText).toBe('')
  })

  it('keeps the paid order authoritative when the benefits snapshot is unavailable', async () => {
    commerce.getOrder.mockResolvedValue(membershipOrder)
    commerce.getMembershipBenefits.mockRejectedValue(new Error('TEMPORARY_FAILURE'))

    const instance = await check('order-m')

    expect(instance.data.result).toBe('success')
    expect(instance.data.description).toBe('支付成功，会员权益已开通。')
  })
})
