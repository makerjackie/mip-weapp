// 交互类 Bug 修复回归（审计 2026-10-12，docs/research/weapp-interaction-bugs-audit-2026-10-12.md）：
// BUG-10.1 公告触底+下拉交错重复项 / BUG-10.2 我的活动追加去重 / BUG-10.3 合作伙伴页
// onShow 闪骨架 / BUG-10.4 growth 会员态无 seq / BUG-11.1 名片刷新失败整页错误 /
// BUG-11.2 任务详情提交后刷新失败整页错误 / BUG-11.3 名片下载静默吞点击 /
// BUG-12.1 首页冷启动公告双请求与内容跳变。
import fs from 'node:fs'
import path from 'node:path'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { MipOpportunityError } from '../src/modules/mip-opportunities/error'

const announcementsModule = vi.hoisted(() => ({ list: vi.fn(), peekList: vi.fn() }))
const bannersModule = vi.hoisted(() => ({ listActive: vi.fn() }))
const eventsClient = vi.hoisted(() => ({
  listEvents: vi.fn(),
  peekEvents: vi.fn(),
  listMyRegistrations: vi.fn(),
  cancelRegistration: vi.fn(),
}))
const identityClient = vi.hoisted(() => ({
  identity: {
    loadSnapshot: vi.fn(),
    peekSnapshot: vi.fn(),
    getProfileCardSettings: vi.fn(),
    getMyProfileCardCode: vi.fn(),
    getPublicProfile: vi.fn(),
    getProfile: vi.fn(),
    consumePendingResume: vi.fn(() => null),
  },
  branches: { load: vi.fn(), peek: vi.fn() },
}))
const opportunities = vi.hoisted(() => ({ list: vi.fn(), listCooperators: vi.fn() }))
const commerce = vi.hoisted(() => ({
  getMembershipBenefits: vi.fn(),
  peekPlans: vi.fn(() => []),
}))
const growthClient = vi.hoisted(() => ({ peekSnapshot: vi.fn(), getSnapshot: vi.fn() }))
const tasksModule = vi.hoisted(() => ({
  query: { getTask: vi.fn(), listTasks: vi.fn() },
  mutation: { completeTask: vi.fn() },
  saveTemplateImage: vi.fn(),
}))

vi.mock('../src/modules/mip-announcements', () => ({ mipAnnouncementsModule: announcementsModule }))
vi.mock('../src/modules/mip-banners', () => ({ mipBannerModule: bannersModule }))
vi.mock('../src/modules/mip-events/client', () => ({
  mipCheckInResumeStore: { clear: vi.fn() },
  mipEventsModule: eventsClient,
}))
vi.mock('../src/modules/mip-identity/client', () => ({
  mipIdentityModule: identityClient.identity,
  mipBranchesModule: identityClient.branches,
}))
vi.mock('../src/modules/mip-opportunities', () => ({
  opportunityModule: opportunities,
  MipOpportunityError,
}))
vi.mock('../src/modules/mip-commerce/client', () => ({ mipCommerceModule: commerce }))
vi.mock('../src/modules/mip-growth/client', () => ({ mipGrowthModule: growthClient }))
vi.mock('../src/modules/mip-identity', () => ({ mipAccessPageUrl: vi.fn() }))
vi.mock('../src/config/runtime', () => ({ runtimeConfig: { paymentMode: 'test' } }))
vi.mock('../src/modules/mip-shell', () => ({
  createIntentKey: vi.fn(() => 'intent-key'),
  formatCny: (cents: number) => `¥${(cents / 100).toFixed(2)}`,
}))
vi.mock('../src/modules/mip-tasks', () => ({
  mipTasksModule: tasksModule,
  rewardExperienceStarIndexes: vi.fn(() => []),
}))
vi.mock('../src/modules/mip-tasks/client', () => ({ mipTasksModule: tasksModule }))
vi.mock('../src/modules/mip-media/client', () => ({ mipMediaModule: { uploadImageFromPath: vi.fn() } }))
vi.mock('../src/platform/wechat/image-upload', () => ({ chooseSingleImage: vi.fn() }))
vi.mock('../src/platform/navigation/client', () => ({
  caseNavigateTo: vi.fn(),
  caseRedirectTo: vi.fn(),
  caseSwitchPrimary: vi.fn(),
  syncCaseNavigation: vi.fn(),
}))
vi.mock('../src/platform/cloudbase/client', () => ({ requireCloudClient: vi.fn() }))

interface PageDefinition {
  data: Record<string, unknown>
  [key: string]: unknown
}

const definitions: Record<string, PageDefinition> = {}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

function page(key: keyof typeof definitions) {
  const instance = Object.create(definitions[key]) as PageDefinition
  instance.data = structuredClone(definitions[key].data)
  instance.setData = (patch: Record<string, unknown>) => Object.assign(instance.data, patch)
  return instance
}

function callPage(instance: PageDefinition, method: string, ...args: unknown[]) {
  const handler = instance[method]
  if (typeof handler !== 'function') {
    throw new TypeError(`Missing page method: ${method}`)
  }
  return Reflect.apply(handler as (...rest: unknown[]) => unknown, instance, args)
}

beforeAll(async () => {
  vi.stubGlobal('wx', {
    showToast: vi.fn(),
    saveImageToPhotosAlbum: vi.fn(),
    stopPullDownRefresh: vi.fn(),
  })
  let current: PageDefinition | undefined
  vi.stubGlobal('Page', (definition: PageDefinition) => {
    current = definition
  })
  current = undefined
  await import('../src/packages/member/announcements/index')
  definitions.announcements = current as PageDefinition
  current = undefined
  await import('../src/packages/member/mip-events/mine/index')
  definitions.mine = current as PageDefinition
  current = undefined
  await import('../src/packages/member/mip-opportunity-cooperators/index')
  definitions.cooperators = current as PageDefinition
  current = undefined
  await import('../src/packages/member/mip-growth/index')
  definitions.growth = current as PageDefinition
  current = undefined
  await import('../src/packages/member/mip-card/index')
  definitions.card = current as PageDefinition
  current = undefined
  await import('../src/packages/member/mip-tasks/detail/index')
  definitions.taskDetail = current as PageDefinition
  current = undefined
  await import('../src/pages/index/index')
  definitions.home = current as PageDefinition
})

describe('BUG-10.1 announcements list race', () => {
  beforeEach(() => {
    announcementsModule.peekList.mockReset().mockReturnValue(undefined)
    announcementsModule.list.mockReset()
  })

  function summary(id: string) {
    return {
      id,
      title: `公告${id}`,
      summary: '',
      isPinned: false,
      publishedAt: '2026-10-01T08:00:00.000Z',
      scopeType: 'PLATFORM',
      targetType: 'ARTICLE',
      targetId: '',
    }
  }

  it('drops the stale loadMore append when a pull refresh reset the whole page', async () => {
    // 机制：loadMore（旧游标）在途时下拉刷新整表重置（代际 +1），
    // 旧结果返回后按代际作废，不再拼接到新首页尾部造成 wx:key="id" 重复。
    const staleAppend = deferred<{ items: Array<ReturnType<typeof summary>>, nextCursor?: string }>()
    announcementsModule.list
      .mockResolvedValueOnce({ items: [summary('a1'), summary('a2')], nextCursor: 'cursor-1' })
      .mockReturnValueOnce(staleAppend.promise)
      .mockResolvedValueOnce({ items: [summary('a0')], nextCursor: 'cursor-2' })
    const instance = page('announcements')
    await callPage(instance, 'loadAnnouncements')
    const appendRun = callPage(instance, 'loadMore') as Promise<void>
    expect(instance.data.loadingMore).toBe(true)
    const refreshRun = callPage(instance, 'onPullDownRefresh') as Promise<void>
    await refreshRun
    staleAppend.resolve({ items: [summary('a2'), summary('a3')] })
    await appendRun
    const ids = (instance.data.items as Array<{ id: string }>).map(item => item.id)
    expect(ids).toEqual(['a0'])
    expect(new Set(ids).size).toBe(ids.length)
    expect(instance.data.loadingMore).toBe(false)
    expect(instance.data.state).toBe('ready')
  })

  it('dedupes by id when the append window overlaps the already loaded page', async () => {
    announcementsModule.list
      .mockResolvedValueOnce({ items: [summary('a1'), summary('a2')], nextCursor: 'cursor-1' })
      .mockResolvedValueOnce({ items: [summary('a2'), summary('a3')], nextCursor: '' })
    const instance = page('announcements')
    await callPage(instance, 'loadAnnouncements')
    await callPage(instance, 'loadMore')
    const ids = (instance.data.items as Array<{ id: string }>).map(item => item.id)
    expect(ids).toEqual(['a1', 'a2', 'a3'])
  })

  it('does not start a new append with the old cursor while a refresh is in flight', async () => {
    // 机制：refreshing 挡住「整表刷新在途时用旧游标发起新追加」的窗口（对齐 orders 页）。
    const refresh = deferred<{ items: Array<ReturnType<typeof summary>>, nextCursor?: string }>()
    announcementsModule.list
      .mockResolvedValueOnce({ items: [summary('a1'), summary('a2')], nextCursor: 'cursor-1' })
      .mockReturnValueOnce(refresh.promise)
    const instance = page('announcements')
    await callPage(instance, 'loadAnnouncements')
    const refreshRun = callPage(instance, 'loadAnnouncements', true) as Promise<void>
    expect(instance.data.refreshing).toBe(true)
    await callPage(instance, 'loadMore')
    expect(announcementsModule.list).toHaveBeenCalledTimes(2)
    refresh.resolve({ items: [summary('a0')], nextCursor: 'cursor-2' })
    await refreshRun
    expect(instance.data.refreshing).toBe(false)
    expect((instance.data.items as Array<{ id: string }>).map(item => item.id)).toEqual(['a0'])
  })
})

describe('BUG-10.2 my-events append dedupe', () => {
  beforeEach(() => {
    eventsClient.listMyRegistrations.mockReset()
  })

  function registration(registrationId: string, eventId: string) {
    return {
      registrationId,
      version: 1,
      status: 'REGISTERED',
      canEdit: false,
      canCancel: false,
      canRetryRefund: false,
      updatedAt: '2026-10-01T00:00:00.000Z',
      event: {
        id: eventId,
        scopeType: 'CITY',
        title: `活动 ${eventId}`,
        summary: '',
        eventTypeLabel: '沙龙',
        tags: [],
        videoRecaps: [],
        mode: 'OFFLINE',
        accessType: 'FREE',
        startsAt: '2026-10-20T10:00:00.000Z',
        endsAt: '2026-10-20T12:00:00.000Z',
        status: 'PUBLISHED',
        registrationCount: 3,
        participantPreview: [],
      },
    }
  }

  it('appends without duplicating an overlapping registrationId', async () => {
    // 机制：追加时按 registrationId 用 Map 去重（与 participants 页同款），
    // 游标窗口重叠时 wx:key="registrationId" 不再撞 key。
    eventsClient.listMyRegistrations
      .mockResolvedValueOnce({ items: [registration('r1', 'e1')], counts: { upcoming: 1, attended: 0 }, nextCursor: 'cursor-1' })
      .mockResolvedValueOnce({ items: [registration('r1', 'e1'), registration('r2', 'e2')], nextCursor: '' })
    const instance = page('mine')
    await callPage(instance, 'loadRegistrations')
    await callPage(instance, 'loadMore')
    const ids = (instance.data.registrations as Array<{ registrationId: string }>).map(item => item.registrationId)
    expect(ids).toEqual(['r1', 'r2'])
  })
})

describe('BUG-10.3 cooperators repeat onShow keeps ready', () => {
  beforeEach(() => {
    opportunities.listCooperators.mockReset()
  })

  function cooperator(profileRef: string) {
    return { profileRef, nickname: `伙伴${profileRef}` }
  }

  it('keeps the loaded roster visible (state stays ready) while a repeat load is in flight', async () => {
    // 机制：已有内容时 load 保持 ready 后台刷新（对齐 orders 页口径），
    // 不再整屏闪骨架 / 重置滚动位置。
    const second = deferred<{ items: Array<ReturnType<typeof cooperator>>, nextCursor?: string }>()
    opportunities.listCooperators
      .mockResolvedValueOnce({ items: [cooperator('p1')], nextCursor: '' })
      .mockReturnValueOnce(second.promise)
    const instance = page('cooperators')
    callPage(instance, 'onLoad', { id: '30000000-0000-4000-8000-000000000009' })
    await callPage(instance, 'load')
    expect(instance.data.state).toBe('ready')
    callPage(instance, 'onShow')
    expect(instance.data.state).toBe('ready')
    expect(instance.data.people).toHaveLength(1)
    second.resolve({ items: [cooperator('p1'), cooperator('p2')], nextCursor: '' })
    await vi.waitFor(() => expect(instance.data.people).toHaveLength(2))
    expect(instance.data.state).toBe('ready')
  })

  it('keeps the roster and surfaces a message when the repeat load fails', async () => {
    opportunities.listCooperators
      .mockResolvedValueOnce({ items: [cooperator('p1')], nextCursor: '' })
      .mockRejectedValueOnce(new Error('网络中断'))
    const instance = page('cooperators')
    callPage(instance, 'onLoad', { id: '30000000-0000-4000-8000-000000000009' })
    await callPage(instance, 'load')
    await callPage(instance, 'load')
    expect(instance.data.state).toBe('ready')
    expect(instance.data.people).toHaveLength(1)
    expect(instance.data.message).toContain('网络中断')
  })
})

describe('BUG-10.4 membership actions sequence guard', () => {
  beforeEach(() => {
    commerce.getMembershipBenefits.mockReset()
  })

  it('keeps the newest membership projection when an older concurrent request finishes last', async () => {
    // 机制：loadMembershipActions 补代际号（对齐 loadGrowth/loadTasks），
    // onShow 与下拉刷新并发时旧请求的迟到写入被丢弃。
    const older = deferred<{ kind: string, status?: string, benefits?: [], history?: [] }>()
    const newer = deferred<{ kind: string, membershipEndsAt?: string }>()
    commerce.getMembershipBenefits.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise)
    const instance = page('growth')
    const olderRun = callPage(instance, 'loadMembershipActions') as Promise<void>
    const newerRun = callPage(instance, 'loadMembershipActions') as Promise<void>
    newer.resolve({ kind: 'PLAYER', membershipEndsAt: '2027-08-08T00:00:00.000Z' })
    await newerRun
    older.resolve({ kind: 'GUEST', status: 'NONE', benefits: [], history: [] })
    await olderRun
    expect(instance.data.membershipState).toBe('player')
    expect(instance.data.isPlayer).toBe(true)
  })
})

describe('BUG-11.1 / BUG-11.3 member card refresh and download feedback', () => {
  beforeEach(() => {
    identityClient.identity.loadSnapshot.mockReset()
    identityClient.identity.getProfileCardSettings.mockReset()
    identityClient.identity.getMyProfileCardCode.mockReset()
    identityClient.identity.getPublicProfile.mockReset()
    identityClient.identity.getProfile.mockReset()
    vi.mocked(wx.showToast).mockClear()
    vi.mocked(wx.saveImageToPhotosAlbum).mockClear()
  })

  function primeCardLoad() {
    identityClient.identity.loadSnapshot.mockResolvedValueOnce({ profileRef: 'profile-1' })
    identityClient.identity.getProfileCardSettings.mockResolvedValueOnce({
      enabled: true,
      templates: [{ key: 'PINK', name: '暖色', requiredFields: [] }],
    })
    identityClient.identity.getMyProfileCardCode.mockResolvedValueOnce({ codeUrl: 'https://code.example/mip.png' })
    identityClient.identity.getPublicProfile.mockResolvedValueOnce({
      realName: '阿明',
      nickname: 'Ame',
      avatarUrl: '',
      companies: [],
      organizations: [],
    })
    identityClient.identity.getProfile.mockResolvedValueOnce({
      realName: '阿明',
      privateContact: {},
      visibility: { cardContacts: {} },
    })
  }

  it('keeps the rendered card when an onShow refresh fails (AGENTS.md §11)', async () => {
    const instance = page('card')
    primeCardLoad()
    await callPage(instance, 'loadCard')
    expect(instance.data.state).toBe('ready')
    identityClient.identity.loadSnapshot.mockRejectedValueOnce(new Error('身份服务抖动'))
    await callPage(instance, 'loadCard')
    expect(instance.data.state).toBe('ready')
    expect(instance.data.nickname).toBe('阿明')
    expect(instance.data.message).toContain('已保留上次结果')
  })

  it('still shows the full-page error when the first load fails with no content', async () => {
    const instance = page('card')
    identityClient.identity.loadSnapshot.mockRejectedValueOnce(new Error('彻底失败'))
    await callPage(instance, 'loadCard')
    expect(instance.data.state).toBe('error')
    expect(instance.data.message).toBe('彻底失败')
  })

  it('tells the user the share image is still rendering instead of swallowing the tap', async () => {
    // 机制：分享图渲染期间（drawingShare）点下载，给出 toast 反馈且按钮 disabled 绑定该口径。
    const instance = page('card')
    instance.data.state = 'ready'
    instance.data.drawingShare = true
    await callPage(instance, 'savePoster')
    expect(wx.showToast).toHaveBeenCalledWith({ title: '图片生成中，请稍候', icon: 'none' })
    expect(wx.saveImageToPhotosAlbum).not.toHaveBeenCalled()
    const template = fs.readFileSync(path.join(process.cwd(), 'src/packages/member/mip-card/index.wxml'), 'utf8')
    expect(template).toContain('disabled="{{generating || drawingShare}}"')
  })
})

describe('BUG-11.2 task detail refresh keeps content', () => {
  beforeEach(() => {
    tasksModule.query.getTask.mockReset()
  })

  function taskCard(id: string) {
    return {
      id,
      name: '完善资料',
      content: '任务正文',
      rewardExperience: 10,
      attachmentRequired: false,
      endsAt: '2026-10-30T00:00:00.000Z',
      hasTemplate: false,
      version: 1,
      status: 'AVAILABLE',
    }
  }

  it('keeps the task body with a message when the post-submit refresh fails', async () => {
    tasksModule.query.getTask.mockResolvedValueOnce(taskCard('task-1')).mockRejectedValueOnce(new Error('刷新失败'))
    const instance = page('taskDetail')
    instance.setData({ taskId: 'task-1' })
    await callPage(instance, 'loadTask')
    expect(instance.data.state).toBe('ready')
    await callPage(instance, 'loadTask')
    expect(instance.data.state).toBe('ready')
    expect((instance.data.task as { id: string }).id).toBe('task-1')
    expect(instance.data.message).toContain('已保留上次内容')
  })

  it('shows the full-page error only when there is no content yet', async () => {
    tasksModule.query.getTask.mockRejectedValueOnce(new Error('加载失败'))
    const instance = page('taskDetail')
    instance.setData({ taskId: 'task-2' })
    await callPage(instance, 'loadTask')
    expect(instance.data.state).toBe('error')
    expect(instance.data.message).toBe('加载失败')
  })
})

describe('BUG-12.1 home cold start issues one announcement request', () => {
  beforeEach(() => {
    announcementsModule.peekList.mockReset().mockReturnValue(undefined)
    announcementsModule.list.mockReset().mockResolvedValue({ items: [] })
    bannersModule.listActive.mockReset().mockResolvedValue([])
    eventsClient.listEvents.mockReset().mockResolvedValue({ items: [] })
    eventsClient.peekEvents.mockReset().mockReturnValue(undefined)
    eventsClient.listMyRegistrations.mockReset()
    identityClient.branches.load.mockReset().mockResolvedValue({ branches: [] })
    identityClient.branches.peek.mockReset().mockReturnValue(undefined)
    identityClient.identity.loadSnapshot.mockReset()
    identityClient.identity.peekSnapshot.mockReset().mockReturnValue(undefined)
    opportunities.list.mockReset().mockResolvedValue({ items: [] })
  })

  it('waits for identity settlement and issues exactly one branch-scoped request', async () => {
    // 机制：公告请求等身份「落地」（复用 loadIdentity 已发起的同一飞行，不新增请求），
    // 分会变化时 applyIdentity 发出唯一一次正确口径请求，settleAnnouncements 跳过补发。
    const identity = deferred<{ primaryBranchId?: string }>()
    identityClient.identity.loadSnapshot.mockReturnValue(identity.promise)
    announcementsModule.list.mockResolvedValue({ items: [{ id: 'branch-announcement', isPinned: true }] })
    const instance = page('home')
    const discover = callPage(instance, 'loadDiscover') as Promise<void>
    identity.resolve({ primaryBranchId: 'branch-1' })
    await discover
    expect(announcementsModule.list).toHaveBeenCalledTimes(1)
    expect(announcementsModule.list).toHaveBeenCalledWith({ branchId: 'branch-1', limit: 5 })
    expect((instance.data.announcement as { id: string }).id).toBe('branch-announcement')
  })

  it('issues one city-wide request when identity settles without a primary branch', async () => {
    const identity = deferred<{ primaryBranchId?: string }>()
    identityClient.identity.loadSnapshot.mockReturnValue(identity.promise)
    const instance = page('home')
    const discover = callPage(instance, 'loadDiscover') as Promise<void>
    identity.resolve({})
    await discover
    expect(announcementsModule.list).toHaveBeenCalledTimes(1)
    expect(announcementsModule.list).toHaveBeenCalledWith({ branchId: undefined, limit: 5 })
  })

  it('falls back to one city-wide request when identity fails', async () => {
    identityClient.identity.loadSnapshot.mockRejectedValue(new Error('offline'))
    const instance = page('home')
    await callPage(instance, 'loadDiscover')
    expect(announcementsModule.list).toHaveBeenCalledTimes(1)
    expect(announcementsModule.list).toHaveBeenCalledWith({ branchId: undefined, limit: 5 })
    expect(instance.data.state).toBe('ready')
  })
})
