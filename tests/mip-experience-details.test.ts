import fs from 'node:fs'
import path from 'node:path'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const growth = vi.hoisted(() => ({
  listEntries: vi.fn(),
}))
const identity = vi.hoisted(() => ({
  getMembershipAgreement: vi.fn(),
}))

vi.mock('../src/modules/mip-growth/client', () => ({ mipGrowthModule: growth }))
vi.mock('../src/modules/mip-identity/client', () => ({ mipIdentityModule: identity }))

interface PageDefinition {
  data: Record<string, unknown>
  [key: string]: unknown
}

let definition: PageDefinition

function page(definition: PageDefinition) {
  return Object.assign(Object.create(definition) as PageDefinition, {
    data: structuredClone(definition.data),
    setData(patch: Record<string, unknown>, callback?: () => void) {
      Object.assign(this.data, patch)
      callback?.()
    },
  })
}

function callPage(instance: PageDefinition, method: string, ...args: unknown[]) {
  const handler = instance[method]
  if (typeof handler !== 'function') {
    throw new TypeError(`Missing page method: ${method}`)
  }
  return Reflect.apply(handler, instance, args) as Promise<void> | void
}

function rulesDocument(overrides: Record<string, unknown> = {}) {
  return {
    title: '经验值规则说明',
    body: '一、每日签到\n二、活动奖励',
    isDemo: false,
    version: 2,
    updatedAt: '2026-03-01T08:00:00+08:00',
    ...overrides,
  }
}

function entryPage(items: Array<Record<string, unknown>>, nextCursor?: string) {
  return { items, nextCursor }
}

function entry(overrides: Record<string, unknown> = {}) {
  return {
    id: 'entry-1',
    ruleKey: 'early-sign-in',
    ruleName: '早会签到',
    sourceEventType: 'CHECK_IN',
    metric: 'EXPERIENCE',
    deltaValue: 10,
    balanceAfter: 120,
    createdAt: '2026-03-01T09:30:00+08:00',
    ...overrides,
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

beforeAll(async () => {
  vi.stubGlobal('wx', { stopPullDownRefresh: vi.fn() })
  vi.stubGlobal('Page', (pageDefinition: PageDefinition) => {
    definition = pageDefinition
  })
  await import('../src/packages/member/mip-experience-details/index')
})

beforeEach(() => {
  vi.clearAllMocks()
  growth.listEntries.mockResolvedValue(entryPage([entry()]))
  identity.getMembershipAgreement.mockResolvedValue(rulesDocument())
})

describe('member experience details page', () => {
  it('lands on the details tab and fetches the EXPERIENCE entry page from the server', async () => {
    const instance = page(definition)
    expect(instance.data.tab).toBe('details')

    await callPage(instance, 'onLoad')
    await vi.waitFor(() => expect(instance.data.state).toBe('ready'))
    // MIW-27：指标过滤由服务端执行（客户端裁剪会破坏 keyset 分页游标）。
    expect(growth.listEntries).toHaveBeenCalledWith(undefined, 20, 'EXPERIENCE')

    const entries = instance.data.entries as Array<{ title: string, deltaPrefix: string, deltaValue: number }>
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ title: '早会签到', deltaPrefix: '+ EXP ', deltaValue: 10 })
  })

  // MIW-27 第二轮评审修正：规则详情页签是管理后台配置的「一整个文本」，
  // 与经验值明细的逐条流水卡不同；读取 membership-content 的 experience-rules 文档。
  it('loads the whole rules text from the experience-rules document channel', async () => {
    const instance = page(definition)
    await callPage(instance, 'onLoad')
    await vi.waitFor(() => expect(instance.data.state).toBe('ready'))
    expect(identity.getMembershipAgreement).toHaveBeenCalledWith('experience-rules')
    const rulesDetail = instance.data.rulesDetail as { title: string, body: string, isDemo: boolean }
    expect(rulesDetail).toMatchObject({ title: '经验值规则说明', body: '一、每日签到\n二、活动奖励', isDemo: false })
  })

  it('renders negative deltas without a leading plus and falls back when the rule name is missing', async () => {
    growth.listEntries.mockResolvedValue(entryPage([
      entry({ id: 'entry-neg', ruleName: '', deltaValue: -5 }),
    ]))
    const instance = page(definition)
    await callPage(instance, 'onLoad')
    await vi.waitFor(() => expect(instance.data.state).toBe('ready'))

    const entries = instance.data.entries as Array<{ title: string, deltaPrefix: string, deltaValue: number }>
    expect(entries[0]).toMatchObject({ title: '经验值变动', deltaPrefix: 'EXP ', deltaValue: -5 })
  })

  it('appends the next EXPERIENCE page with the server cursor on load more', async () => {
    growth.listEntries
      .mockResolvedValueOnce(entryPage([entry({ id: 'entry-1' })], 'cursor-2'))
      .mockResolvedValueOnce(entryPage([entry({ id: 'entry-2' })]))
    const instance = page(definition)
    await callPage(instance, 'onLoad')
    await vi.waitFor(() => expect(instance.data.nextCursor).toBe('cursor-2'))

    await callPage(instance, 'loadMore')
    expect(growth.listEntries).toHaveBeenLastCalledWith('cursor-2', 20, 'EXPERIENCE')
    expect((instance.data.entries as Array<{ id: string }>).map(item => item.id)).toEqual(['entry-1', 'entry-2'])
    expect(instance.data.nextCursor).toBe('')
  })

  it('keeps the newest load result when an older refresh finishes later', async () => {
    const older = deferred<ReturnType<typeof rulesDocument>>()
    const newer = deferred<ReturnType<typeof rulesDocument>>()
    identity.getMembershipAgreement.mockReset()
    identity.getMembershipAgreement.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise)
    growth.listEntries.mockReset()
    growth.listEntries.mockResolvedValue(entryPage([]))
    const instance = page(definition)

    const first = callPage(instance, 'load', true) as Promise<void>
    const second = callPage(instance, 'load', true) as Promise<void>
    newer.resolve(rulesDocument())
    await second
    older.resolve(rulesDocument())
    await first
    expect(instance.data.state).toBe('ready')
  })

  it('switches to the rules tab from the design tab bar without refetching', async () => {
    const instance = page(definition)
    await callPage(instance, 'onLoad')
    await vi.waitFor(() => expect(instance.data.state).toBe('ready'))
    const calls = growth.listEntries.mock.calls.length

    callPage(instance, 'chooseTab', { currentTarget: { dataset: { tab: 'rules' } } })
    expect(instance.data.tab).toBe('rules')
    expect(growth.listEntries).toHaveBeenCalledTimes(calls)
  })

  it('shows the error state when the first load fails and recovers on retry', async () => {
    growth.listEntries.mockRejectedValueOnce(new Error('服务暂时不可用'))
    const instance = page(definition)
    await callPage(instance, 'onLoad')
    await vi.waitFor(() => expect(instance.data.state).toBe('error'))
    expect(instance.data.message).toBe('服务暂时不可用')

    await callPage(instance, 'load')
    await vi.waitFor(() => expect(instance.data.state).toBe('ready'))
    expect(instance.data.message).toBe('')
  })

  it('stops the pull-down spinner after refreshing', async () => {
    const instance = page(definition)
    await callPage(instance, 'onPullDownRefresh')
    await vi.waitFor(() => expect(instance.data.state).toBe('ready'))
    expect(wx.stopPullDownRefresh).toHaveBeenCalled()
    expect(identity.getMembershipAgreement).toHaveBeenCalledWith('experience-rules')
  })

  it('keeps the restored detail-page design contract in the page bundle', () => {
    const template = fs.readFileSync(
      path.join(process.cwd(), 'src/packages/member/mip-experience-details/index.wxml'),
      'utf8',
    )
    const styles = fs.readFileSync(
      path.join(process.cwd(), 'src/packages/member/mip-experience-details/index.wxss'),
      'utf8',
    )
    const pageConfig = fs.readFileSync(
      path.join(process.cwd(), 'src/packages/member/mip-experience-details/index.json'),
      'utf8',
    )

    // figma 1948_14177：默认「经验值明细」页签，双页签含规则详情；明细卡为
    // panel 底 67px 卡，左侧任务名 12px + 副行 10px，右侧「+ EXP N」黄字。
    expect(template).toContain('规则详情')
    expect(template).toContain('经验值明细')
    expect(template).toContain('wx:for="{{entries}}"')
    expect(template).toContain('class="exp-detail-card bg-panel"')
    expect(template).toContain('{{item.deltaPrefix}}')
    // MIW-27 第二轮评审修正：规则详情绑定后台配置的整段文本（rulesDetail.body，保留换行）。
    expect(template).toContain('{{rulesDetail.body}}')
    expect(template).toContain('whitespace-pre-wrap')
    const card = styles.match(/\.exp-detail-card\s*\{([^}]+)\}/)?.[1]
    expect(card).toContain('min-height: 134rpx')
    expect(card).toContain('border-radius: var(--mip-radius-card-small)')
    expect(pageConfig).toContain('"navigationBarTitleText": "经验值详情"')
    expect(pageConfig).toContain('"enablePullDownRefresh": true')
  })
})
