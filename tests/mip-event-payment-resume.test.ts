import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { MipEventsError } from '../src/modules/mip-events'

vi.mock('../src/config/runtime', () => ({ runtimeConfig: {} }))

const mocks = vi.hoisted(() => ({ getMyRegistration: vi.fn(), register: vi.fn(), payOrder: vi.fn(), navigateTo: vi.fn() }))
vi.mock('../src/modules/mip-events/client', () => ({ mipEventsModule: { getMyRegistration: mocks.getMyRegistration, register: mocks.register }, mipCheckInResumeStore: {} }))
vi.mock('../src/modules/mip-commerce/client', () => ({ mipCommerceModule: { payOrder: mocks.payOrder } }))
vi.mock('../src/modules/mip-identity/client', () => ({ mipIdentityModule: {} }))
vi.mock('../src/modules/mip-messaging/client', () => ({ mipMessagingModule: {} }))
vi.mock('../src/platform/navigation/client', () => ({ caseNavigateTo: mocks.navigateTo, caseRedirectTo: vi.fn() }))
let definition: Record<string, any>
beforeAll(async () => {
  vi.stubGlobal('Page', (value: Record<string, any>) => {
    definition = value
  })
  await import('../src/packages/member/order-detail/index')
})
beforeEach(() => {
  vi.clearAllMocks()
  mocks.getMyRegistration.mockResolvedValue({ status: 'PAYMENT_PENDING', orderId: 'o1', formVersion: 2, answers: { reason: '原内容' }, shareProfile: false })
  mocks.register.mockResolvedValue({ kind: 'PAYMENT_REQUIRED', orderId: 'o1' })
  mocks.payOrder.mockResolvedValue({ kind: 'CANCELLED' })
})
function page() {
  const instance = Object.create(definition)
  instance.data = { ...definition.data, order: { id: 'o1', orderType: 'EVENT', resourceId: 'e1' }, paymentPending: true }
  instance.setData = (value: Record<string, unknown>) => Object.assign(instance.data, value)
  return instance
}
describe('event order payment resumption', () => {
  it('renews the existing registration before paying its order', async () => {
    await page().performPayment()
    expect(mocks.register).toHaveBeenCalledWith(expect.objectContaining({ eventId: 'e1', formVersion: 2, answers: { reason: '原内容' }, shareProfile: false }))
    expect(mocks.register.mock.invocationCallOrder[0]).toBeLessThan(mocks.payOrder.mock.invocationCallOrder[0]!)
    expect(mocks.payOrder).toHaveBeenCalledWith('o1')
  })
  it('requires the user to review the updated form before payment', async () => {
    mocks.register.mockRejectedValue(new MipEventsError('CONFLICT', '报名表已更新'))
    await page().performPayment()
    expect(mocks.payOrder).not.toHaveBeenCalled()
    expect(mocks.navigateTo).toHaveBeenCalledWith({ url: '/packages/member/mip-events/registration/index?eventId=e1' })
  })
  it('does not pay a stale order when the registration now belongs to another order', async () => {
    mocks.getMyRegistration.mockResolvedValue({ status: 'PAYMENT_PENDING', orderId: 'o2', formVersion: 2 })
    await page().performPayment()
    expect(mocks.register).not.toHaveBeenCalled()
    expect(mocks.payOrder).not.toHaveBeenCalled()
  })
})
