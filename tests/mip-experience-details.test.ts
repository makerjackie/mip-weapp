import fs from 'node:fs'
import path from 'node:path'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const growth = vi.hoisted(() => ({
  peekSnapshot: vi.fn(),
  getSnapshot: vi.fn(),
  listEntries: vi.fn(),
}))

vi.mock('../src/modules/mip-growth/client', () => ({ mipGrowthModule: growth }))

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

function snapshot() {
  return {
    account: { userId: 'user-1', experienceBalance: 120, contributionBalance: 0, coinBalance: 0, version: 1 },
    currentLevel: {
      id: 'lv1',
      levelKey: 'L1',
      name: 'Lv.1',
      minimumExperience: 0,
      benefits: [],
      status: 'ACTIVE',
    },
    levels: [
      { id: 'lv1', levelKey: 'L1', name: 'Lv.1', minimumExperience: 0, benefits: [], status: 'ACTIVE' },
    ],
    earningRules: [
      { id: 'rule-exp-1', ruleKey: 'early-sign-in', name: '早会签到', description: '每天完成早会签到，最多累计 30 经验值。', metric: 'EXPERIENCE', deltaValue: 10, dailyLimitValue: 30, sourceEventType: 'CHECK_IN', status: 'ACTIVE' },
      { id: 'rule-exp-2', ruleKey: 'case-adopted', name: '案例被采纳', metric: 'EXPERIENCE', deltaValue: 50, sourceEventType: 'CASE_ADOPTED', status: 'ACTIVE' },
      { id: 'rule-con-1', ruleKey: 'post-adopted', name: '投稿采纳', metric: 'CONTRIBUTION', deltaValue: 20, dailyLimitValue: 100, sourceEventType: 'POST_ADOPTED', status: 'ACTIVE' },
    ],
    levelProgressPercent: 0,
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
  growth.getSnapshot.mockResolvedValue(snapshot())
  growth.peekSnapshot.mockReturnValue(snapshot())
  growth.listEntries.mockResolvedValue(entryPage([entry()]))
})

describe('member experience details page', () => {
  it('lands on the details tab and fetches the EXPERIENCE entry page from the server', async () => {
    const instance = page(definition)
    expect(instance.data.tab).toBe('details')

    await callPage(instance, 'onLoad')
    await vi.waitFor(() => expect(instance.data.state).toBe('ready'))
    // MIW-27：指标过滤由服务端执行（客户端裁剪会破坏 keyset 分页游标）。
    expect(growth.listEntries).toHaveBeenCalledWith(undefined, 20, 'EXPERIENCE')
    expect(growth.getSnapshot).toHaveBeenCalledWith({ force: false })

    const entries = instance.data.entries as Array<{ title: string, deltaPrefix: string, deltaValue: number }>
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ title: '早会签到', deltaPrefix: '+ EXP ', deltaValue: 10 })

    // 规则页签只列经验值规则：优先展示管理后台配置的规则说明，
    // 未配置时回退为派生的每日上限文案（贡献值规则不进入该页签）。
    const rules = instance.data.rules as Array<{ name: string, detailText: string }>
    expect(rules.map(rule => rule.name)).toEqual(['早会签到', '案例被采纳'])
    expect(rules.map(rule => rule.detailText)).toEqual([
      '每天完成早会签到，最多累计 30 经验值。',
      '无每日上限',
    ])
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
    const older = deferred<ReturnType<typeof snapshot>>()
    const newer = deferred<ReturnType<typeof snapshot>>()
    growth.getSnapshot.mockReset()
    growth.getSnapshot.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise)
    growth.listEntries.mockReset()
    growth.listEntries.mockResolvedValue(entryPage([]))
    const instance = page(definition)

    const first = callPage(instance, 'load', true) as Promise<void>
    const second = callPage(instance, 'load', true) as Promise<void>
    newer.resolve(snapshot())
    await second
    older.resolve(snapshot())
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
    expect(growth.getSnapshot).toHaveBeenCalledWith({ force: true })
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
    // MIW-27 第二轮：规则卡正文绑定后台配置的规则说明（detailText）。
    expect(template).toContain('{{item.detailText}}')
    const card = styles.match(/\.exp-detail-card\s*\{([^}]+)\}/)?.[1]
    expect(card).toContain('min-height: 134rpx')
    expect(card).toContain('border-radius: var(--mip-radius-card-small)')
    expect(pageConfig).toContain('"navigationBarTitleText": "经验值详情"')
    expect(pageConfig).toContain('"enablePullDownRefresh": true')
  })
})
