import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const messaging = vi.hoisted(() => ({ subscriptionCapability: vi.fn(), requestWechatSubscription: vi.fn() }))
vi.mock('../src/modules/mip-messaging/client', () => ({ mipMessagingModule: messaging }))
let definition: any
beforeAll(async () => {
  vi.stubGlobal('Component', (value: unknown) => {
    definition = value
  })
  await import('../src/components/mip-subscription-prompt/index')
  vi.unstubAllGlobals()
})
beforeEach(() => {
  vi.resetAllMocks()
})
function instance() {
  return {
    ...definition.methods,
    data: { ...definition.data, templateKey: 'EVENT_REMINDER' },
    setData(patch: Record<string, unknown>) { Object.assign(this.data, patch) },
  }
}
describe('contextual subscription prompt', () => {
  it('does not request authorization when mounted or when no template is available', async () => {
    messaging.subscriptionCapability.mockReturnValue({ available: false })
    const page = instance()
    definition.lifetimes.attached.call(page)
    await page.request()
    expect(page.data.available).toBe(false)
    expect(messaging.requestWechatSubscription).not.toHaveBeenCalled()
  })
  it('requests only on a gesture and prevents repeated requests after acceptance', async () => {
    messaging.subscriptionCapability.mockReturnValue({ available: true })
    messaging.requestWechatSubscription.mockResolvedValue({ grantAvailable: true })
    const page = instance()
    definition.lifetimes.attached.call(page)
    expect(messaging.requestWechatSubscription).not.toHaveBeenCalled()
    await Promise.all([page.request(), page.request()])
    await page.request()
    expect(messaging.requestWechatSubscription).toHaveBeenCalledExactlyOnceWith('EVENT_REMINDER')
    expect(page.data.granted).toBe(true)
  })
  it('keeps rejection and request failures local and allows an explicit retry', async () => {
    messaging.subscriptionCapability.mockReturnValue({ available: true })
    messaging.requestWechatSubscription.mockResolvedValueOnce({ grantAvailable: false }).mockRejectedValueOnce(new Error('offline'))
    const page = instance()
    definition.lifetimes.attached.call(page)
    await page.request()
    expect(page.data.granted).toBe(false)
    expect(page.data.message).toContain('不影响')
    await page.request()
    expect(page.data.requesting).toBe(false)
    expect(page.data.message).toContain('重试')
  })
})
