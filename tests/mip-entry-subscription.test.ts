import { readdirSync, readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'

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

const readSource = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const STORAGE_KEY = 'mip:opportunity-subscribe-guide:v1'
const DAY = 24 * 60 * 60 * 1000

// wx 在函数运行期才被读取，静态导入安全；stub 保留到文件结束（勿 unstub）。
vi.stubGlobal('wx', { getStorageSync: storage.get, setStorageSync: storage.set })
const { requestEntrySubscription } = await import('../src/modules/mip-messaging/entry-subscription')

beforeEach(() => {
  vi.resetAllMocks()
  storage.entries.clear()
})

function persisted() {
  return storage.entries.get(STORAGE_KEY) as {
    shownAtByOpportunity: Record<string, number>
    rejectedCountByTemplate: Record<string, number>
    decidedTemplates: Record<string, string>
  }
}

describe('requestEntrySubscription (MIW-77 业务按钮 tap 前置授权)', () => {
  it('never requests while the template is unavailable', async () => {
    messaging.subscriptionCapability.mockReturnValue({ templateKey: 'X', available: false, reason: 'TEMPLATE_MISSING' })
    await requestEntrySubscription('X', 'publish-entry')
    expect(messaging.requestWechatSubscription).not.toHaveBeenCalled()
    expect(storage.entries.size).toBe(0)
  })

  it('requests inside the tap and records shown pacing plus the decision', async () => {
    messaging.subscriptionCapability.mockReturnValue({ available: true })
    messaging.requestWechatSubscription.mockResolvedValue({ decision: 'ACCEPTED', grantAvailable: true })
    await requestEntrySubscription('OPPORTUNITY_NOTICE', 'publish-entry')
    expect(messaging.requestWechatSubscription).toHaveBeenCalledExactlyOnceWith('OPPORTUNITY_NOTICE')
    expect(persisted().decidedTemplates.OPPORTUNITY_NOTICE).toBe('ACCEPTED')
    expect(persisted().shownAtByOpportunity['publish-entry']).toBeGreaterThan(0)
  })

  it('paces one request per action key per 24h', async () => {
    messaging.subscriptionCapability.mockReturnValue({ available: true })
    messaging.requestWechatSubscription.mockResolvedValue({ decision: 'REJECTED', grantAvailable: false })
    await requestEntrySubscription('OPPORTUNITY_NOTICE', 'publish-entry')
    await requestEntrySubscription('OPPORTUNITY_NOTICE', 'publish-entry')
    expect(messaging.requestWechatSubscription).toHaveBeenCalledExactlyOnceWith('OPPORTUNITY_NOTICE')
  })

  it('re-asks after the 24h window following a soft rejection (no manual fallback entry)', async () => {
    messaging.subscriptionCapability.mockReturnValue({ available: true })
    messaging.requestWechatSubscription.mockResolvedValue({ decision: 'ACCEPTED', grantAvailable: true })
    // 预置一条已过 24h 窗口的软拒绝记录（节奏键一致、模板未终态）。
    storage.entries.set(STORAGE_KEY, {
      shownAtByOpportunity: { 'publish-entry': Date.now() - DAY - 1 },
      rejectedCountByTemplate: { OPPORTUNITY_NOTICE: 1 },
      decidedTemplates: {},
    })
    await requestEntrySubscription('OPPORTUNITY_NOTICE', 'publish-entry')
    expect(messaging.requestWechatSubscription).toHaveBeenCalledExactlyOnceWith('OPPORTUNITY_NOTICE')
    // ACCEPTED 是终态：之后任何动作键都不再拉面板。
    messaging.requestWechatSubscription.mockClear()
    await requestEntrySubscription('OPPORTUNITY_NOTICE', 'event-register')
    expect(messaging.requestWechatSubscription).not.toHaveBeenCalled()
  })

  it('skips permanently after the user bans the template', async () => {
    messaging.subscriptionCapability.mockReturnValue({ available: true })
    messaging.requestWechatSubscription.mockResolvedValue({ decision: 'BANNED', grantAvailable: false })
    await requestEntrySubscription('HEART_RECEIVED', 'hearts-entry')
    await requestEntrySubscription('HEART_RECEIVED', 'hearts-entry')
    expect(messaging.requestWechatSubscription).toHaveBeenCalledExactlyOnceWith('HEART_RECEIVED')
    expect(persisted().decidedTemplates.HEART_RECEIVED).toBe('BANNED')
  })

  it('keeps the 24h pacing even when the native panel call fails', async () => {
    messaging.subscriptionCapability.mockReturnValue({ available: true })
    messaging.requestWechatSubscription.mockRejectedValueOnce(new Error('offline'))
    await expect(requestEntrySubscription('EVENT_REMINDER', 'event-register')).resolves.toBeUndefined()
    // 失败也记展示节奏：不连环打扰；业务动作（报名）不受影响。
    expect(persisted().shownAtByOpportunity['event-register']).toBeGreaterThan(0)
    await requestEntrySubscription('EVENT_REMINDER', 'event-register')
    expect(messaging.requestWechatSubscription).toHaveBeenCalledExactlyOnceWith('EVENT_REMINDER')
  })
})

describe('MIW-77 wiring: authorization lives only in business button taps', () => {
  const walk = (dir: string): string[] => readdirSync(new URL(`../${dir}`, import.meta.url), { withFileTypes: true })
    .flatMap((entry) => {
      const path = `${dir}/${entry.name}`
      return entry.isDirectory() ? walk(path) : /\.(?:ts|wxml|json)$/.test(entry.name) ? [path] : []
    })

  it('leaves no guide-layer or prompt module mounted anywhere (设计稿无此形态)', () => {
    const offenders = walk('src').filter(path => readSource(path).match(/mip-subscription-guide|mip-subscription-prompt/))
    expect(offenders).toEqual([])
  })

  it('keeps pending landing machinery deleted (no auto popup on landing pages)', () => {
    const offenders = walk('src').filter(path => readSource(path).match(/GUIDE_PENDING|subscribeGuideOpportunityId|checkSubscriptionGuide/))
    expect(offenders).toEqual([])
  })

  it('fires the publish authorization inside the save tap, before any async work', () => {
    const editor = readSource('src/packages/member/mip-opportunities/editor/index.ts')
    const save = editor.match(/async save\(publish: boolean\) \{[\s\S]*?\n {2}\},/)?.[0] || ''
    expect(save).toContain('requestEntrySubscription(\'OPPORTUNITY_NOTICE\', GUIDE_PUBLISH_ENTRY_KEY)')
    // 授权调用在 saving 置位（进入异步保存）之前：原生面板仍在 tap 手势上下文内。
    expect(save.indexOf('requestEntrySubscription')).toBeLessThan(save.indexOf('setData({ saving: true'))
    // 编辑器不再有进入即弹的 onReady 前置授权
    expect(editor.match(/onReady\(\)/)).toBeNull()
  })

  it('fires the event reminder authorization inside the registration submit tap', () => {
    const registration = readSource('src/packages/member/mip-events/registration/index.ts')
    const submit = registration.match(/async submit\(\) \{[\s\S]*?\n {2}\},/)?.[0] || ''
    expect(submit).toContain('requestEntrySubscription(\'EVENT_REMINDER\', GUIDE_EVENT_REGISTER_KEY)')
    expect(submit.indexOf('requestEntrySubscription')).toBeLessThan(submit.indexOf('setData({ busy: true'))
  })

  it('routes every native panel call through the shared entry helper', () => {
    // 全仓库只有 messaging 模块内部与既有「继续签到」按钮（CHECKIN_RESULT 每次签到
    // 消耗一张一次性授权，按设计每次 tap 都补额度，tap 内同步拉起、拒绝不拦截，
    // 与共享入口同一手势口径）允许触达原生面板；其余必须走 requestEntrySubscription。
    const allowed = new Set([
      'src/modules/mip-messaging/entry-subscription.ts',
      'src/modules/mip-messaging/client.ts',
      'src/modules/mip-messaging/module.ts',
      'src/modules/mip-messaging/wechat-subscription.ts',
      'src/packages/member/order-detail/index.ts',
      'src/packages/member/payment-result/index.ts',
    ])
    const offenders = walk('src')
      .filter(path => !allowed.has(path))
      .filter(path => readSource(path).match(/requestWechatSubscription|requestSubscribeMessage/))
    expect(offenders).toEqual([])
  })

  it('keeps the env template keys that the entry authorizations and server delivery rely on', () => {
    expect(readSource('.env.example')).toContain('OPPORTUNITY_NOTICE')
    expect(readSource('.env.example')).toContain('EVENT_REMINDER')
    expect(readSource('.env.example')).toContain('HEART_RECEIVED')
  })
})
