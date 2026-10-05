import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const messaging = vi.hoisted(() => ({ subscriptionCapability: vi.fn(), requestWechatSubscription: vi.fn() }))
const storage = vi.hoisted(() => {
  const entries = new Map<string, unknown>()
  return {
    entries,
    get: (key: string) => entries.get(key),
    set: (key: string, value: unknown) => {
      entries.set(key, value)
    },
  }
})
vi.mock('../src/modules/mip-messaging/client', () => ({ mipMessagingModule: messaging }))

const STORAGE_KEY = 'mip:opportunity-subscribe-guide:v1'
let definition: any
beforeAll(async () => {
  vi.stubGlobal('wx', {
    getStorageSync: storage.get,
    setStorageSync: storage.set,
    showToast: vi.fn(),
  })
  vi.stubGlobal('Component', (value: unknown) => {
    definition = value
  })
  await import('../src/components/mip-subscription-guide/index')
  // 保留 wx stub 到文件结束：组件 attached/方法在运行期仍需读写 storage。
})
beforeEach(() => {
  vi.resetAllMocks()
  storage.entries.clear()
})
function instance(opportunityId = 'opp-1') {
  const page = {
    ...definition.methods,
    data: { ...definition.data, templateKey: 'OPPORTUNITY_NOTICE', opportunityId },
    setData(patch: Record<string, unknown>) {
      Object.assign(this.data, patch)
    },
  }
  definition.lifetimes.attached.call(page)
  return page
}
function persisted() {
  return storage.entries.get(STORAGE_KEY) as {
    shownAtByOpportunity: Record<string, number>
    rejectedCountByTemplate: Record<string, number>
    decidedTemplates: Record<string, string>
  }
}

describe('mip-subscription-guide', () => {
  it('never renders or requests while the template is unavailable (S7)', async () => {
    messaging.subscriptionCapability.mockReturnValue({ templateKey: 'OPPORTUNITY_NOTICE', available: false, reason: 'TEMPLATE_MISSING' })
    const page = instance()
    page.check()
    expect(page.data.visible).toBe(false)
    await page.request()
    expect(messaging.requestWechatSubscription).not.toHaveBeenCalled()
  })

  it('shows the request layer on check and asks for authorization only from the button tap (S1/S4)', async () => {
    messaging.subscriptionCapability.mockReturnValue({ templateKey: 'OPPORTUNITY_NOTICE', available: true })
    messaging.requestWechatSubscription.mockResolvedValue({ templateKey: 'OPPORTUNITY_NOTICE', decision: 'ACCEPTED', grantAvailable: true })
    const page = instance()
    page.check()
    expect(page.data.visible).toBe(true)
    expect(page.data.mode).toBe('REQUEST')
    expect(messaging.requestWechatSubscription).not.toHaveBeenCalled()
    await page.request()
    expect(messaging.requestWechatSubscription).toHaveBeenCalledExactlyOnceWith('OPPORTUNITY_NOTICE')
    expect(page.data.visible).toBe(false)
    expect(persisted().decidedTemplates.OPPORTUNITY_NOTICE).toBe('ACCEPTED')
    expect(persisted().shownAtByOpportunity['opp-1']).toBeGreaterThan(0)
  })

  it('does not reshow the layer inside the cadence window (D2)', () => {
    messaging.subscriptionCapability.mockReturnValue({ templateKey: 'OPPORTUNITY_NOTICE', available: true })
    const page = instance()
    page.check()
    page.dismiss()
    expect(page.data.visible).toBe(false)
    // 同一机会 24h 内最多 1 次：新实例回读持久化节奏记录
    const again = instance()
    again.check()
    expect(again.data.visible).toBe(false)
    // 另一个机会不受影响
    const other = instance('opp-2')
    other.check()
    expect(other.data.visible).toBe(true)
  })

  it('accepts an explicit opportunity id for the publish-timing landing (S8)', () => {
    messaging.subscriptionCapability.mockReturnValue({ templateKey: 'OPPORTUNITY_NOTICE', available: true })
    // 列表页挂载形态：property 无机会 ID，发布 pending 的 ID 由参数传入
    const list = instance('')
    list.check('opp-9')
    expect(list.data.visible).toBe(true)
    expect(persisted().shownAtByOpportunity['opp-9']).toBeGreaterThan(0)
    // 节奏键仍是同一机会 ID：随后进详情不再重复弹（S1 复用同一记录）
    const detail = instance('opp-9')
    detail.check()
    expect(detail.data.visible).toBe(false)
  })

  it('switches to manual guidance after a rejection without re-requesting (S5)', async () => {
    messaging.subscriptionCapability.mockReturnValue({ templateKey: 'OPPORTUNITY_NOTICE', available: true })
    messaging.requestWechatSubscription.mockResolvedValue({ templateKey: 'OPPORTUNITY_NOTICE', decision: 'REJECTED', grantAvailable: false })
    const page = instance()
    page.check()
    await page.request()
    expect(page.data.visible).toBe(true)
    expect(page.data.mode).toBe('MANUAL')
    expect(persisted().rejectedCountByTemplate.OPPORTUNITY_NOTICE).toBe(1)
    // MANUAL 形态不再拉起原生面板（D4：手动开启只走文案）
    await page.request()
    expect(messaging.requestWechatSubscription).toHaveBeenCalledExactlyOnceWith('OPPORTUNITY_NOTICE')
  })

  it('hides permanently after a ban and keeps the recorded terminal decision (S6)', async () => {
    messaging.subscriptionCapability.mockReturnValue({ templateKey: 'OPPORTUNITY_NOTICE', available: true })
    messaging.requestWechatSubscription.mockResolvedValue({ templateKey: 'OPPORTUNITY_NOTICE', decision: 'BANNED', grantAvailable: false })
    const page = instance()
    page.check()
    await page.request()
    expect(page.data.visible).toBe(false)
    expect(persisted().decidedTemplates.OPPORTUNITY_NOTICE).toBe('BANNED')
    const again = instance()
    again.check()
    expect(again.data.visible).toBe(false)
  })

  it('keeps request failures local and allows an explicit retry', async () => {
    messaging.subscriptionCapability.mockReturnValue({ templateKey: 'OPPORTUNITY_NOTICE', available: true })
    messaging.requestWechatSubscription.mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ templateKey: 'OPPORTUNITY_NOTICE', decision: 'ACCEPTED', grantAvailable: true })
    const page = instance()
    page.check()
    await page.request()
    expect(page.data.mode).toBe('REQUEST')
    expect(page.data.message).toContain('重试')
    expect(page.data.requesting).toBe(false)
    await page.request()
    expect(page.data.visible).toBe(false)
  })
})
