import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { MipEventsError } from '../src/modules/mip-events'

vi.mock('../src/config/runtime', () => ({ runtimeConfig: {} }))

const mocks = vi.hoisted(() => ({
  getMyRegistration: vi.fn(),
  cancelRegistration: vi.fn(),
  getOrder: vi.fn(),
  navigateTo: vi.fn(),
  redirectTo: vi.fn(),
}))
vi.mock('../src/modules/mip-events/client', () => ({
  mipEventsModule: { getMyRegistration: mocks.getMyRegistration, cancelRegistration: mocks.cancelRegistration },
  mipCheckInResumeStore: { clear: vi.fn(), peek: vi.fn(() => false) },
}))
vi.mock('../src/modules/mip-commerce/client', () => ({ mipCommerceModule: { getOrder: mocks.getOrder, ensurePaymentCapability: vi.fn(async () => ({ available: true })), reconcile: vi.fn(), listPlans: vi.fn(async () => []) } }))
vi.mock('../src/modules/mip-identity/client', () => ({ mipIdentityModule: {} }))
vi.mock('../src/modules/mip-messaging/client', () => ({ mipMessagingModule: {} }))
vi.mock('../src/platform/navigation/client', () => ({ caseNavigateTo: mocks.navigateTo, caseRedirectTo: mocks.redirectTo }))
vi.mock('../src/platform/storage/component-media', () => ({ updatePageMedia: vi.fn(), clearPageMedia: vi.fn() }))

let definition: Record<string, any>
beforeAll(async () => {
  vi.stubGlobal('wx', {
    showModal: vi.fn(async () => ({ confirm: true })),
    showToast: vi.fn(),
    showLoading: vi.fn(),
    hideLoading: vi.fn(),
  })
  vi.stubGlobal('Page', (value: Record<string, any>) => {
    definition = value
  })
  await import('../src/packages/member/order-detail/index')
})
function eventOrder() {
  return {
    id: 'o1',
    orderType: 'EVENT',
    resourceId: 'e1',
    status: 'PAID',
    amountCents: 59800,
    refundedAmountCents: 0,
    currency: 'CNY',
    serviceStatus: 'UNAVAILABLE',
    version: 1,
    event: { title: '活动', startsAt: '2026-11-01T02:00:00Z' },
  }
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.getMyRegistration.mockResolvedValue({ status: 'REGISTERED', version: 3, formVersion: 1, answers: {}, canEdit: false, canCancel: true, canRetryRefund: false })
  mocks.cancelRegistration.mockResolvedValue({ registrationId: 'r1', status: 'CANCELLED', refundRequired: false, paymentAvailable: true })
  mocks.getOrder.mockResolvedValue(eventOrder())
})
function page(order = eventOrder()) {
  const instance = Object.create(definition)
  instance.data = { ...definition.data, orderId: 'o1', order, eventId: order.resourceId || '' }
  instance.setData = (value: Record<string, unknown>) => Object.assign(instance.data, value)
  return instance
}

describe('MIW-128 order detail cancellation entry', () => {
  it('shows the cancel entry only after the server-authoritative registration read allows it', async () => {
    // 合同：非空服务端响应 → 页面状态。canCancel/canRetryRefund 由 myRegistration 裁决，
    // 客户端不得按订单状态自行推导。
    const instance = page()
    await instance.loadEventRegistration(instance.data.order)
    expect(instance.data.eventCancelAvailable).toBe(true)
    expect(instance.data.eventCancelRetryRefund).toBe(false)
    expect(instance.data.eventRegistrationVersion).toBe(3)

    mocks.getMyRegistration.mockResolvedValue({ status: 'REGISTERED', version: 3, formVersion: 1, answers: {}, canEdit: false, canCancel: false, canRetryRefund: false })
    await instance.loadEventRegistration(instance.data.order)
    expect(instance.data.eventCancelAvailable).toBe(false)
  })

  it('hides the entry when the registration read fails instead of masking the order body', async () => {
    const instance = page()
    mocks.getMyRegistration.mockRejectedValue(new Error('network'))
    await instance.loadEventRegistration(instance.data.order)
    expect(instance.data.eventCancelAvailable).toBe(false)
    expect(instance.data.eventCancelRetryRefund).toBe(false)
    expect(instance.data.eventRegistrationVersion).toBe(0)
  })

  it('confirms once, cancels with the optimistic version and reloads the order', async () => {
    const instance = page()
    instance.data.eventCancelAvailable = true
    instance.data.eventRegistrationVersion = 3
    await instance.cancelEventRegistration()
    expect(wx.showModal).toHaveBeenCalledTimes(1)
    expect(mocks.cancelRegistration).toHaveBeenCalledWith('e1', 3)
    expect(wx.showToast).toHaveBeenCalledWith(expect.objectContaining({ title: '报名已取消' }))
    expect(mocks.getOrder).toHaveBeenCalledWith('o1')
    expect(instance.data.cancelingRegistration).toBe(false)
  })

  it('offers the refund retry wording when the server reports a stuck refund', async () => {
    mocks.getMyRegistration.mockResolvedValue({ status: 'CANCELLATION_PENDING', version: 4, formVersion: 1, answers: {}, canEdit: false, canCancel: false, canRetryRefund: true })
    const instance = page()
    await instance.loadEventRegistration(instance.data.order)
    expect(instance.data.eventCancelAvailable).toBe(true)
    await instance.cancelEventRegistration()
    expect(wx.showModal).toHaveBeenCalledWith(expect.objectContaining({ title: '继续处理退款' }))
    expect(mocks.cancelRegistration).toHaveBeenCalledWith('e1', 4)
  })

  it('never opens the confirm modal for a stale registration version', async () => {
    const instance = page()
    instance.data.eventCancelAvailable = true
    instance.data.eventRegistrationVersion = 0
    await instance.cancelEventRegistration()
    expect(wx.showModal).not.toHaveBeenCalled()
    expect(mocks.cancelRegistration).not.toHaveBeenCalled()
    // 触发一次重新加载报名状态。
    expect(mocks.getMyRegistration).toHaveBeenCalled()
  })

  it('reloads order and registration on a version conflict instead of retrying the write', async () => {
    const instance = page()
    instance.data.eventCancelAvailable = true
    instance.data.eventRegistrationVersion = 3
    mocks.cancelRegistration.mockRejectedValue(new MipEventsError('CONFLICT', '报名状态已变化'))
    await instance.cancelEventRegistration()
    expect(mocks.cancelRegistration).toHaveBeenCalledTimes(1)
    expect(instance.data.message).toContain('报名状态已变化')
    expect(mocks.getOrder).toHaveBeenCalled()
    expect(instance.data.cancelingRegistration).toBe(false)
  })

  it('keeps the cancel entry out of non-event orders', async () => {
    const membership = { ...eventOrder(), orderType: 'MEMBERSHIP', resourceId: '' }
    const instance = page(membership)
    instance.setData({ isEventOrder: false })
    await instance.applyOrder(membership, [])
    expect(instance.data.eventCancelAvailable).toBe(false)
  })
})
