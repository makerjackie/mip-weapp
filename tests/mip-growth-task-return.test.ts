import fs from 'node:fs'
import path from 'node:path'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const growth = vi.hoisted(() => ({
  peekSnapshot: vi.fn(),
  getSnapshot: vi.fn(),
  listEntries: vi.fn(),
}))
const commerce = vi.hoisted(() => ({
  getMembershipBenefits: vi.fn(),
  createMembershipInvitation: vi.fn(),
}))
const tasks = vi.hoisted(() => ({
  listTasks: vi.fn(),
  completeTask: vi.fn(),
}))

vi.mock('../src/modules/mip-growth/client', () => ({ mipGrowthModule: growth }))
vi.mock('../src/modules/mip-commerce/client', () => ({ mipCommerceModule: commerce }))
vi.mock('../src/modules/mip-tasks/client', () => ({ mipTasksModule: { query: { listTasks: tasks.listTasks } } }))
vi.mock('../src/modules/mip-tasks', () => ({
  mipTasksModule: { query: { listTasks: tasks.listTasks }, mutation: { completeTask: tasks.completeTask } },
  rewardExperienceStarIndexes: vi.fn(() => []),
}))
vi.mock('../src/platform/navigation/client', () => ({ caseNavigateTo: vi.fn() }))

interface PageDefinition {
  data: Record<string, unknown>
  [key: string]: unknown
}

let growthDefinition: PageDefinition
let tasksDefinition: PageDefinition

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

function snapshot(experienceBalance: number) {
  const level = { id: 'lv1', levelKey: 'L1', name: 'Lv.1', minimumExperience: 0, benefits: [], status: 'ACTIVE' }
  return {
    account: { userId: 'user-1', experienceBalance, contributionBalance: 0, coinBalance: 0, version: 1 },
    currentLevel: level,
    levels: [level],
    earningRules: [],
    levelProgressPercent: 0,
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
  vi.stubGlobal('wx', { navigateTo: vi.fn(), showToast: vi.fn(), pageScrollTo: vi.fn() })
  vi.stubGlobal('Page', (definition: PageDefinition) => {
    growthDefinition = definition
  })
  await import('../src/packages/member/mip-growth/index')
  vi.stubGlobal('Page', (definition: PageDefinition) => {
    tasksDefinition = definition
  })
  await import('../src/packages/member/mip-tasks/index')
})

beforeEach(() => {
  vi.clearAllMocks()
  growth.peekSnapshot.mockReturnValue(snapshot(10))
  growth.getSnapshot.mockResolvedValue(snapshot(20))
  growth.listEntries.mockResolvedValue({ items: [] })
  commerce.getMembershipBenefits.mockResolvedValue({ kind: 'GUEST' })
  tasks.listTasks.mockResolvedValue({ items: [] })
})

describe('growth and task return flow', () => {
  it('keeps full balances, rules and history behind the experience details entry', () => {
    const instance = page(growthDefinition)
    expect(instance.data.experienceDetailsOpen).toBe(false)

    callPage(instance, 'openExperienceDetails')
    expect(instance.data.experienceDetailsOpen).toBe(true)
    expect(wx.pageScrollTo).toHaveBeenCalledWith({ selector: '#growth-details-section', duration: 200 })

    callPage(instance, 'closeExperienceDetails')
    expect(instance.data.experienceDetailsOpen).toBe(false)
    expect(wx.pageScrollTo).toHaveBeenLastCalledWith({ scrollTop: 0, duration: 200 })
  })

  it('refreshes server balances and tasks on every return to the growth page', async () => {
    const instance = page(growthDefinition)
    callPage(instance, 'onLoad')
    expect((instance.data.snapshot as ReturnType<typeof snapshot>).account.experienceBalance).toBe(10)
    expect(growth.getSnapshot).not.toHaveBeenCalled()

    callPage(instance, 'onShow')
    await vi.waitFor(() => expect((instance.data.snapshot as ReturnType<typeof snapshot>).account.experienceBalance).toBe(20))
    expect(growth.getSnapshot).toHaveBeenCalledWith({ force: true })
    expect(tasks.listTasks).toHaveBeenCalledWith(undefined, 4, true)
  })

  it('keeps the newest growth response when an older refresh completes later', async () => {
    const older = deferred<ReturnType<typeof snapshot>>()
    const newer = deferred<ReturnType<typeof snapshot>>()
    growth.getSnapshot.mockReset().mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise)
    const instance = page(growthDefinition)
    const first = callPage(instance, 'loadGrowth', true) as Promise<void>
    const second = callPage(instance, 'loadGrowth', true) as Promise<void>
    newer.resolve(snapshot(50))
    await second
    older.resolve(snapshot(20))
    await first
    expect((instance.data.snapshot as ReturnType<typeof snapshot>).account.experienceBalance).toBe(50)
  })

  it('keeps the newest task list when a hidden-page request finishes late', async () => {
    const older = deferred<{ items: Array<{ id: string, status: 'AVAILABLE', name: string }> }>()
    tasks.listTasks.mockReset().mockReturnValueOnce(older.promise).mockResolvedValueOnce({ items: [{ id: 'new', status: 'AVAILABLE', name: '新任务' }] })
    const instance = page(growthDefinition)
    const first = callPage(instance, 'loadTasks', true) as Promise<void>
    callPage(instance, 'onHide')
    await callPage(instance, 'loadTasks', true)
    older.resolve({ items: [{ id: 'old', status: 'AVAILABLE', name: '旧任务' }] })
    await first
    expect((instance.data.tasks as Array<{ id: string }>).map(item => item.id)).toEqual(['new'])
  })

  it('does not present a purchase action when membership status is unknown', async () => {
    commerce.getMembershipBenefits.mockRejectedValue(new Error('offline'))
    const instance = page(growthDefinition)
    await callPage(instance, 'loadMembershipActions')
    expect(instance.data.membershipState).toBe('error')
    const template = fs.readFileSync(path.join(process.cwd(), 'src/packages/member/mip-growth/index.wxml'), 'utf8')
    expect(template).toContain('wx:if="{{membershipState === \'guest\'}}"')
    expect(template).toContain('wx:elif="{{membershipState === \'error\'}}"')
  })

  it('opens required-attachment tasks in detail instead of submitting without an attachment', async () => {
    const instance = page(tasksDefinition)
    instance.data.tasks = [{ id: 'task-1', status: 'AVAILABLE', attachmentRequired: true }]
    await callPage(instance, 'completeTask', { currentTarget: { dataset: { id: 'task-1' } } })
    expect(tasks.completeTask).not.toHaveBeenCalled()
    expect(wx.navigateTo).toHaveBeenCalledWith({ url: '/packages/member/mip-tasks/detail/index?taskId=task-1' })
  })

  it('still completes tasks without an attachment from the list', async () => {
    tasks.completeTask.mockResolvedValue({ submissionStatus: 'approved' })
    const instance = page(tasksDefinition)
    instance.data.tasks = [{ id: 'task-2', status: 'AVAILABLE', attachmentRequired: false }]
    instance.loadTasks = vi.fn().mockResolvedValue(undefined)
    await callPage(instance, 'completeTask', { currentTarget: { dataset: { id: 'task-2' } } })
    expect(tasks.completeTask).toHaveBeenCalledWith('task-2')
    expect(wx.navigateTo).not.toHaveBeenCalled()
  })
  it('loads each status from the server and ignores a previous tabs late response', async () => {
    const old = deferred<{ items: Array<{ id: string, status: string, name: string }> }>()
    tasks.listTasks.mockReset().mockReturnValueOnce(old.promise).mockResolvedValueOnce({
      items: [{ id: 'ended-1', status: 'COMPLETED', name: '已完成任务' }],
      nextCursor: 'ended-next',
    })
    const instance = page(tasksDefinition)
    const first = callPage(instance, 'loadTasks')
    callPage(instance, 'chooseFilter', { currentTarget: { dataset: { filter: 'ended' } } })
    await vi.waitFor(() => expect(instance.data.state).toBe('ready'))
    expect(tasks.listTasks).toHaveBeenNthCalledWith(1, undefined, 20, false, 'pending')
    expect(tasks.listTasks).toHaveBeenNthCalledWith(2, undefined, 20, false, 'ended')
    old.resolve({ items: [{ id: 'pending-1', status: 'AVAILABLE', name: '待办任务' }] })
    await first
    expect((instance.data.visibleTasks as Array<{ id: string }>).map(item => item.id)).toEqual(['ended-1'])
    tasks.listTasks.mockResolvedValueOnce({ items: [{ id: 'ended-2', status: 'ENDED', name: '过期任务' }] })
    await callPage(instance, 'loadMore')
    expect(tasks.listTasks).toHaveBeenLastCalledWith('ended-next', 20, false, 'ended')
    expect((instance.data.visibleTasks as Array<{ id: string }>).map(item => item.id)).toEqual(['ended-1', 'ended-2'])
  })
})
