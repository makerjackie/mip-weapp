// 交互类 bug 修复回归（docs/research/weapp-interaction-bugs-audit-2026-10-12.md）：
// BUG-05 任务完成双击重复提交、BUG-06 活动列表 loadingMore 卡死、BUG-09.2 海报保存双击、
// BUG-10.5 城市选择双击连退、BUG-10.6 选择器受控回环丢更新。
// 模式沿用 tests/mip-growth-task-return.test.ts / client-race-regressions.test.ts：
// stubGlobal Page/Component 捕获定义，Object.create(definition) 构造实例，setData = Object.assign。
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  // BUG-05：mip-tasks 页
  listTasks: vi.fn(),
  completeTask: vi.fn(),
  // BUG-06：events 页
  listEvents: vi.fn(),
  peekEvents: vi.fn(),
  listBanners: vi.fn(),
  peekSnapshot: vi.fn(),
  loadSnapshot: vi.fn(),
  // BUG-09.2：event-console 页
  adminSessionGet: vi.fn(),
  adminEventsGet: vi.fn(),
  saveImageToPhotosAlbum: vi.fn(),
  showToast: vi.fn(),
  // BUG-10.5：city-selector 页
  navigateBack: vi.fn(),
  getCatalogs: vi.fn(),
}))

vi.mock('../src/modules/mip-tasks', () => ({
  mipTasksModule: { query: { listTasks: mocks.listTasks }, mutation: { completeTask: mocks.completeTask } },
  rewardExperienceStarIndexes: vi.fn(() => []),
}))
vi.mock('../src/modules/mip-banners', () => ({ mipBannerModule: { listActive: mocks.listBanners } }))
vi.mock('../src/modules/mip-events/client', () => ({
  mipEventsModule: {
    listEvents: mocks.listEvents,
    peekEvents: mocks.peekEvents,
    createCheckInPoster: vi.fn(),
  },
}))
vi.mock('../src/modules/mip-identity/client', () => ({
  mipIdentityModule: { peekSnapshot: mocks.peekSnapshot, loadSnapshot: mocks.loadSnapshot },
  mipBranchesModule: { peek: vi.fn(), load: vi.fn() },
}))
vi.mock('../src/modules/mip-admin', () => ({
  hasScopedCapability: () => true,
  mipAdminModule: { session: { get: mocks.adminSessionGet }, events: { get: mocks.adminEventsGet } },
}))
vi.mock('../src/modules/mip-opportunities', () => ({ opportunityModule: { getCatalogs: mocks.getCatalogs } }))
vi.mock('../src/platform/navigation/client', () => ({ caseNavigateTo: vi.fn(), syncCaseNavigation: vi.fn() }))
vi.mock('../src/platform/storage/component-media', () => ({
  clearPageMedia: vi.fn(),
  updatePageMedia: (target: { setData: (patch: Record<string, unknown>) => void }, field: string, value: unknown) => {
    target.setData({ [field]: value })
  },
}))

type Definition = { data: Record<string, unknown> } & Record<string, unknown>
type Instance = Definition & { triggerEvent: ReturnType<typeof vi.fn> }

let tasksPage: Definition
let eventsPage: Definition
let consolePage: Definition
let cityPage: Definition
let catalogComponent: Definition
let industryComponent: Definition

function page(definition: Definition, data: Record<string, unknown> = {}) {
  const instance = Object.create(definition) as Definition
  instance.data = Object.assign(structuredClone(definition.data), data)
  instance.setData = (patch: Record<string, unknown>) => Object.assign(instance.data, patch)
  return instance
}

function component(definition: Definition, data: Record<string, unknown> = {}) {
  const instance = page(definition, data) as Instance
  // 真实运行时 Component 会把 methods 合并到实例上（this.emitChange 这类兄弟方法调用）。
  Object.assign(instance, definition.methods)
  instance.triggerEvent = vi.fn()
  return instance
}

function callPage(target: Definition, method: string, ...args: unknown[]) {
  const handler = target[method]
  if (typeof handler !== 'function') {
    throw new TypeError(`Missing method: ${method}`)
  }
  return Reflect.apply(handler as (...rest: unknown[]) => unknown, target, args) as Promise<void> | void
}

// Component 的方法在 methods 段下（Page 是平铺），通过定义对象取 handler、绑定组件实例调用。
function callComponent(definition: Definition, instance: Instance, method: string, ...args: unknown[]) {
  const handler = (definition.methods as Record<string, unknown>)[method]
  if (typeof handler !== 'function') {
    throw new TypeError(`Missing component method: ${method}`)
  }
  return Reflect.apply(handler as (...rest: unknown[]) => unknown, instance, args) as Promise<void> | void
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, reject, resolve }
}

function tapEvent(dataset: Record<string, unknown>) {
  return { currentTarget: { dataset } }
}

beforeAll(async () => {
  vi.stubGlobal('wx', {
    showToast: mocks.showToast,
    navigateBack: mocks.navigateBack,
    saveImageToPhotosAlbum: mocks.saveImageToPhotosAlbum,
    stopPullDownRefresh: vi.fn(),
  })
  vi.stubGlobal('Page', (value: Definition) => {
    tasksPage = value
  })
  await import('../src/packages/member/mip-tasks/index')
  vi.stubGlobal('Page', (value: Definition) => {
    eventsPage = value
  })
  await import('../src/pages/events/index')
  vi.stubGlobal('Page', (value: Definition) => {
    consolePage = value
  })
  await import('../src/packages/admin/event-console/index')
  vi.stubGlobal('Page', (value: Definition) => {
    cityPage = value
  })
  await import('../src/packages/member/mip-cases/city-selector/index')
  vi.stubGlobal('Component', (value: Definition) => {
    catalogComponent = value
  })
  await import('../src/components/catalog-selector/index')
  vi.stubGlobal('Component', (value: Definition) => {
    industryComponent = value
  })
  await import('../src/components/mip-industry-selector/index')
})

beforeEach(() => {
  vi.clearAllMocks()
  mocks.listTasks.mockResolvedValue({ items: [] })
  mocks.listEvents.mockResolvedValue({ items: [], cities: [], nextCursor: '' })
  mocks.listBanners.mockResolvedValue([])
  mocks.peekEvents.mockReturnValue(undefined)
  mocks.peekSnapshot.mockReturnValue({})
  mocks.loadSnapshot.mockResolvedValue({})
})

afterAll(() => {
  vi.unstubAllGlobals()
})

describe('BUG-05 任务列表「完成」防重锁', () => {
  function readyTaskPage() {
    const instance = page(tasksPage)
    instance.data.state = 'ready'
    instance.data.tasks = [{ id: 'task-1', status: 'AVAILABLE', attachmentRequired: false }]
    return instance
  }

  it('双击「完成」只发一次 completeTask mutation，锁在 finally 复位', async () => {
    const completion = deferred<{ submissionStatus: string }>()
    mocks.completeTask.mockReturnValue(completion.promise)
    const instance = readyTaskPage()

    const first = callPage(instance, 'completeTask', tapEvent({ id: 'task-1' })) as Promise<void>
    // 第二次 tap 发生在 mutation 回包前：completingId 已同步置位，直接 return。
    const second = callPage(instance, 'completeTask', tapEvent({ id: 'task-1' })) as Promise<void>
    expect(instance.data.completingId).toBe('task-1')
    await second
    expect(mocks.completeTask).toHaveBeenCalledOnce()

    completion.resolve({ submissionStatus: 'approved' })
    await first
    expect(mocks.showToast).toHaveBeenCalledOnce()
    expect(mocks.listTasks).toHaveBeenCalledWith(undefined, 20, true, 'pending')
    expect(instance.data.completingId).toBe('')
  })

  it('提交失败同样复位锁，重试可以再次发起', async () => {
    mocks.completeTask.mockRejectedValueOnce(new Error('任务提交失败'))
    const instance = readyTaskPage()

    await callPage(instance, 'completeTask', tapEvent({ id: 'task-1' }))
    expect(instance.data.completingId).toBe('')
    expect(instance.data.message).toBe('任务提交失败')

    mocks.completeTask.mockResolvedValueOnce({ submissionStatus: 'approved' })
    await callPage(instance, 'completeTask', tapEvent({ id: 'task-1' }))
    expect(mocks.completeTask).toHaveBeenCalledTimes(2)
    expect(instance.data.completingId).toBe('')
  })
})

describe('BUG-06 活动列表 loadingMore 卡死', () => {
  function readyEventsPage() {
    const instance = page(eventsPage)
    instance.data.state = 'ready'
    instance.data.view = 'UPCOMING'
    instance.data.nextCursor = 'cursor-1'
    return instance
  }

  it('append 在途时新的非追加加载开始即同步复位 loadingMore（刷新成功序列）', async () => {
    const appendFeed = deferred<{ items: [], cities: [], nextCursor: string }>()
    const freshFeed = deferred<{ items: [], cities: [], nextCursor: string }>()
    mocks.listEvents.mockReset().mockReturnValueOnce(appendFeed.promise).mockReturnValueOnce(freshFeed.promise)
    const instance = readyEventsPage()

    const appendRun = callPage(instance, 'loadEvents', { append: true }) as Promise<void>
    expect(instance.data.loadingMore).toBe(true)
    const refreshRun = callPage(instance, 'loadEvents', { force: true }) as Promise<void>
    // 修复核心：非追加请求推进 requestSeq 并 supersede 在途 append，必须同步复位。
    expect(instance.data.loadingMore).toBe(false)

    freshFeed.resolve({ items: [], cities: [], nextCursor: 'fresh-cursor' })
    await refreshRun
    appendFeed.resolve({ items: [], cities: [], nextCursor: 'append-cursor' })
    await appendRun
    expect(instance.data.loadingMore).toBe(false)
    expect(instance.data.nextCursor).toBe('fresh-cursor')
  })

  it('append 在途 + 非追加加载失败且有缓存只写 message，loadingMore 不卡死', async () => {
    const appendFeed = deferred<{ items: [], cities: [], nextCursor: string }>()
    mocks.peekEvents.mockReturnValue({ items: [], cities: [], nextCursor: 'cached-cursor' })
    mocks.listEvents.mockReset().mockReturnValueOnce(appendFeed.promise).mockRejectedValueOnce(new Error('network down'))
    const instance = readyEventsPage()

    const appendRun = callPage(instance, 'loadEvents', { append: true }) as Promise<void>
    const refreshRun = callPage(instance, 'loadEvents', { force: true }) as Promise<void>
    expect(instance.data.loadingMore).toBe(false)
    await refreshRun
    expect(instance.data.message).toBe('活动更新失败，已保留上次结果。')

    // 旧 append 回包因 seq 失配被丢弃，此前这里是 loadingMore 永久 true 的卡死点。
    appendFeed.resolve({ items: [], cities: [], nextCursor: 'append-cursor' })
    await appendRun
    expect(instance.data.loadingMore).toBe(false)
  })

  it('append 自身失败时 catch 复位 loadingMore 并提示', async () => {
    mocks.listEvents.mockReset().mockRejectedValueOnce(new Error('network down'))
    const instance = readyEventsPage()

    await callPage(instance, 'loadEvents', { append: true })
    expect(instance.data.loadingMore).toBe(false)
    expect(instance.data.message).toBe('更多活动加载失败，请稍后重试。')
  })
})

describe('BUG-09.2 admin 签到海报保存锁', () => {
  function readyConsolePage() {
    const instance = page(consolePage)
    instance.data.state = 'ready'
    instance.data.posterPath = 'wxfile://poster.png'
    return instance
  }

  it('双击保存只调一次 saveImageToPhotosAlbum，成功后锁复位且 toast 一次', async () => {
    const save = deferred<void>()
    mocks.saveImageToPhotosAlbum.mockReturnValue(save.promise)
    const instance = readyConsolePage()

    const first = callPage(instance, 'saveCheckInPoster') as Promise<void>
    expect(instance.data.posterSaving).toBe(true)
    const second = callPage(instance, 'saveCheckInPoster') as Promise<void>
    await second
    expect(mocks.saveImageToPhotosAlbum).toHaveBeenCalledOnce()
    expect(mocks.saveImageToPhotosAlbum).toHaveBeenCalledWith({ filePath: 'wxfile://poster.png' })

    save.resolve(undefined)
    await first
    expect(instance.data.posterSaving).toBe(false)
    expect(mocks.showToast).toHaveBeenCalledExactlyOnceWith({ title: '已保存到相册', icon: 'success' })
    expect(instance.data.message).toBe('')
  })

  it('保存失败写入提示并复位锁', async () => {
    mocks.saveImageToPhotosAlbum.mockRejectedValue(new Error('auth denied'))
    const instance = readyConsolePage()

    await callPage(instance, 'saveCheckInPoster')
    expect(instance.data.posterSaving).toBe(false)
    expect(instance.data.message).toBe('保存失败，请检查相册权限后重试。')
  })
})

describe('BUG-10.5 城市选择双击连退', () => {
  it('双击城市 chip 只 emit 一次 citySelected 且只 navigateBack 一次', () => {
    const emit = vi.fn()
    const instance = page(cityPage)
    ;(instance as unknown as { getOpenerEventChannel: () => { emit: typeof emit } }).getOpenerEventChannel = () => ({ emit })
    instance.cityTagIds = { 深圳: 'tag-sz' }

    callPage(instance, 'onPickCity', tapEvent({ label: '深圳' }))
    callPage(instance, 'onPickCity', tapEvent({ label: '深圳' }))

    expect(emit).toHaveBeenCalledExactlyOnceWith('citySelected', { label: '深圳', tagId: 'tag-sz' })
    expect(mocks.navigateBack).toHaveBeenCalledOnce()
  })
})

describe('BUG-10.6 选择器受控回环丢更新', () => {
  const groups = [{
    id: 'industry-a',
    label: '行业一',
    options: [
      { id: 'child-a', label: '子行业一', popular: true },
      { id: 'child-b', label: '子行业二' },
    ],
  }]

  it('catalog-selector 快速连点两个 chip：第二次 change 基于镜像计算，两个都被选中', () => {
    const instance = component(catalogComponent)
    instance.properties = { multiple: true, maxSelections: 8 }
    // 模拟 observer 初始回写（宿主尚未收到任何 change）。
    callComponent(catalogComponent, instance, 'present', groups, [], true, 8)

    callComponent(catalogComponent, instance, 'toggle', tapEvent({ id: 'child-a' }))
    // 宿主 props 还没回写（受控回环窗口内）就点第二个 chip。
    callComponent(catalogComponent, instance, 'toggle', tapEvent({ id: 'child-b' }))

    const changes = instance.triggerEvent.mock.calls.filter(([name]) => name === 'change')
    expect(changes.map(([, detail]) => (detail as { selectedIds: string[] }).selectedIds)).toEqual([
      ['child-a'],
      ['child-a', 'child-b'],
    ])
  })

  it('catalog-selector 宿主回写后镜像同步为最新属性值（清空生效）', () => {
    const instance = component(catalogComponent)
    instance.properties = { multiple: true, maxSelections: 8 }
    callComponent(catalogComponent, instance, 'present', groups, [], true, 8)
    callComponent(catalogComponent, instance, 'toggle', tapEvent({ id: 'child-a' }))
    // 宿主收到 change 后把 selectedIds 收窄为空（例如重置筛选）并回写 props。
    callComponent(catalogComponent, instance, 'present', groups, [], true, 8)
    callComponent(catalogComponent, instance, 'toggle', tapEvent({ id: 'child-b' }))

    const changes = instance.triggerEvent.mock.calls.filter(([name]) => name === 'change')
    expect(changes.at(-1)?.[1]).toEqual({ selectedIds: ['child-b'] })
  })

  it('mip-industry-selector 快速连点两个 chip：两次 change 都保留，不丢第一次选择', () => {
    const instance = component(industryComponent, { multiple: true, maxCount: 8, selectedIds: [] })
    // 模拟 observer 初始回写。
    callComponent(industryComponent, instance, 'present', groups, [])

    callComponent(industryComponent, instance, 'onChipTap', tapEvent({ id: 'child-a' }))
    callComponent(industryComponent, instance, 'onChipTap', tapEvent({ id: 'child-b' }))

    const changes = instance.triggerEvent.mock.calls.filter(([name]) => name === 'change')
    expect(changes.map(([, detail]) => (detail as { selectedIds: string[] }).selectedIds)).toEqual([
      ['child-a'],
      ['child-a', 'child-b'],
    ])
  })

  it('mip-industry-selector 单选语义保持：连点另一个 chip 替换而不是累加', () => {
    const instance = component(industryComponent, { multiple: false, maxCount: 1, selectedIds: [] })
    callComponent(industryComponent, instance, 'present', groups, [])

    callComponent(industryComponent, instance, 'onChipTap', tapEvent({ id: 'child-a' }))
    callComponent(industryComponent, instance, 'onChipTap', tapEvent({ id: 'child-b' }))

    const changes = instance.triggerEvent.mock.calls.filter(([name]) => name === 'change')
    expect(changes.map(([, detail]) => (detail as { selectedIds: string[] }).selectedIds)).toEqual([
      ['child-a'],
      ['child-b'],
    ])
  })

  it('mip-industry-selector 多选达到上限时 limited 提示且选择不变', () => {
    const instance = component(industryComponent, { multiple: true, maxCount: 1, selectedIds: [] })
    callComponent(industryComponent, instance, 'present', groups, [])

    callComponent(industryComponent, instance, 'onChipTap', tapEvent({ id: 'child-a' }))
    callComponent(industryComponent, instance, 'onChipTap', tapEvent({ id: 'child-b' }))

    const changes = instance.triggerEvent.mock.calls.filter(([name]) => name === 'change')
    expect(changes.at(-1)?.[1]).toEqual({ selectedIds: ['child-a'], limited: true })
  })
})
