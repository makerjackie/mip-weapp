import type { HeartCandidate, HeartState } from '../src/modules/mip-events'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { MipEventsError } from '../src/modules/mip-events'

// MIW-76：旧 interaction 页随页删除后，心动投票行为测试改钉在唯一存活面
// participants 页（J2-02 卡片右上角心形）上。MIW-101：交互契约升级为「乐观先行」——
// 点按即本地翻转红心（目标/徽标/toast 即时），服务端同步由单飞 worker 串行消化，
// 失败回滚到最后一次服务端事实；覆盖 restricted/error/loading/无凭证/乐观先行/
// 在途合并/改选取消/CONFLICT 回刷/身份受限/失败回滚十类交互事实。

const eventsModule = vi.hoisted(() => ({
  listHeartCandidates: vi.fn(),
  getHeart: vi.fn(),
  setHeart: vi.fn(),
  patchEventInteractionSummary: vi.fn(),
}))

vi.mock('../src/modules/mip-events/client', () => ({
  mipEventsModule: eventsModule,
}))

vi.mock('../src/platform/navigation/client', () => ({
  caseNavigateTo: vi.fn(),
}))

type PageData = Record<string, unknown>
type PageDefinition = Record<string, unknown> & { data: PageData }

let definition: PageDefinition
const showToast = vi.fn()

const EVENT_ID = '60000000-0000-4000-8000-000000000001'
const ATTENDANCE_TOAST = '完成签到后可参与心动互动。'

function candidate(participantRef: string, selected = false): HeartCandidate {
  return {
    participantRef,
    profileRef: `profile.${participantRef}`,
    nickname: `嘉宾${participantRef}`,
    selected,
  }
}

function heart(version: number, target?: HeartCandidate): HeartState {
  return {
    targetRef: target?.participantRef,
    ...(target ? { target } : {}),
    received: [],
    version,
  }
}

interface MountedPage {
  data: PageData
  setData: (patch: PageData) => void
  [key: string]: unknown
}

function mount(overrides: PageData = {}) {
  const page = { ...definition, data: { ...structuredClone(definition.data), ...overrides } } as MountedPage
  page.setData = (patch: PageData) => Object.assign(page.data, patch)
  const call = (method: string, ...args: unknown[]) =>
    Reflect.apply(definition[method] as (...a: unknown[]) => unknown, page, args)
  return { page, call }
}

function heartTap(profileRef: string) {
  return { currentTarget: { dataset: { profileRef } } }
}

// loadHeartState 经 `void this.loadHeartState()` 触发，宏任务兜底排空微任务链。
const flush = () => new Promise<void>(resolve => setTimeout(resolve, 0))

beforeAll(async () => {
  vi.stubGlobal('wx', { showToast })
  vi.stubGlobal('Page', (input: PageDefinition) => {
    definition = input
  })
  await import('../src/packages/member/mip-events/participants/index')
})

beforeEach(() => {
  for (const mock of Object.values(eventsModule)) {
    mock.mockReset()
  }
  showToast.mockClear()
})

describe('MIP participants heart actions', () => {
  it('keeps restricted sessions read-only with attendance guidance', async () => {
    const { call } = mount({ heartState: 'restricted' })

    await call('toggleHeartVote', heartTap('profile.p1'))

    expect(showToast).toHaveBeenCalledWith({ title: ATTENDANCE_TOAST, icon: 'none' })
    expect(eventsModule.setHeart).not.toHaveBeenCalled()
  })

  it('retries the heart state in place from the error state instead of mutating', async () => {
    eventsModule.listHeartCandidates.mockResolvedValue([candidate('p1')])
    eventsModule.getHeart.mockResolvedValue(heart(5))
    const { page, call } = mount({ heartState: 'error', eventId: EVENT_ID })

    await call('toggleHeartVote', heartTap('profile.p1'))
    await flush()

    expect(showToast).toHaveBeenCalledWith({ title: '心动信息暂时不可用，正在重试。', icon: 'none' })
    expect(eventsModule.setHeart).not.toHaveBeenCalled()
    expect(page.data.heartState).toBe('ready')
    expect(page.data.heartMineCount).toBe(0)
  })

  it('explains the loading state instead of silently dropping taps', async () => {
    const { call } = mount({ heartState: 'loading', eventId: EVENT_ID })

    await call('toggleHeartVote', heartTap('profile.p1'))

    expect(showToast).toHaveBeenCalledWith({ title: '心动功能加载中，请稍候。', icon: 'none' })
    expect(eventsModule.setHeart).not.toHaveBeenCalled()
  })

  it('explains the attendance rule for ticket-less cards instead of calling the server', async () => {
    // MIW-101：嘉宾/玩家名单含未签到参与人（无投票凭证）——红心恒可见，点按就地解释规则。
    const { page, call } = mount({
      heartState: 'ready',
      eventId: EVENT_ID,
      heart: heart(3),
      candidates: [],
      items: [],
      displayItems: [{ profileRef: 'profile.p1', displayName: '嘉宾小王' }],
    })

    await call('toggleHeartVote', heartTap('profile.p1'))

    expect(showToast).toHaveBeenCalledWith({ title: '只能心动同场已签到的其他参与人。', icon: 'none' })
    expect(eventsModule.setHeart).not.toHaveBeenCalled()
    expect((page.data.heart as HeartState).target).toBeUndefined()
  })

  it('flips the heart optimistically before the server answers', async () => {
    let resolveSync!: (value: HeartState) => void
    eventsModule.setHeart.mockImplementationOnce(() => new Promise<HeartState>((resolve) => {
      resolveSync = resolve
    }))
    const target = candidate('ticket-p1')
    const { page, call } = mount({
      heartState: 'ready',
      eventId: EVENT_ID,
      heart: { ...heart(3), counts: { myInterestCount: 0, receivedInterestCount: 2 } },
      candidates: [candidate('p1')],
      items: [],
      displayItems: [{ profileRef: 'profile.p1', heartTicket: 'ticket-p1' }],
    })

    const pending = call('toggleHeartVote', heartTap('profile.p1'))

    // MIW-101：不等数据库链路——红心目标、徽标与 toast 在写请求返回前即时到位。
    expect((page.data.heart as HeartState).target?.profileRef).toBe('profile.p1')
    expect(page.data.heartMineCount).toBe(1)
    expect(page.data.heartPulseRef).toBe('profile.p1')
    expect(eventsModule.setHeart).toHaveBeenCalledTimes(1)
    expect(showToast).toHaveBeenCalledWith({ title: '已心动', icon: 'success' })

    resolveSync({ ...heart(4, target), counts: { myInterestCount: 1, receivedInterestCount: 2 } })
    await pending

    // 服务端事实到达后校准版本与计数，并回填详情胶囊。
    expect((page.data.heart as HeartState).version).toBe(4)
    expect(page.data.heartMineCount).toBe(1)
    expect(page.data.heartPulseRef).toBe('')
    expect(eventsModule.patchEventInteractionSummary).toHaveBeenCalledWith(
      EVENT_ID,
      { myInterestCount: 1, receivedInterestCount: 2 },
    )
  })

  it('serializes taps during an in-flight sync into the latest desired target', async () => {
    // 服务端回包目标与卡片 profileRef 对齐，凭证为 ticket-*（与展示层 heartTicket 同构）。
    const alice = { ...candidate('alice'), participantRef: 'ticket-alice' }
    const bob = { ...candidate('bob'), participantRef: 'ticket-bob' }
    let resolveFirst!: (value: HeartState) => void
    eventsModule.setHeart
      .mockImplementationOnce(() => new Promise<HeartState>((resolve) => {
        resolveFirst = resolve
      }))
      .mockResolvedValueOnce(heart(5, bob))
    const { page, call } = mount({
      heartState: 'ready',
      eventId: EVENT_ID,
      heart: heart(3),
      candidates: [candidate('alice'), candidate('bob')],
      // PUBLIC 视图不变量：items 与 displayItems 恒同步（页面各路径成对更新）。
      items: [
        { profileRef: 'profile.alice', heartTicket: 'ticket-alice' },
        { profileRef: 'profile.bob', heartTicket: 'ticket-bob' },
      ],
      displayItems: [
        { profileRef: 'profile.alice', heartTicket: 'ticket-alice' },
        { profileRef: 'profile.bob', heartTicket: 'ticket-bob' },
      ],
    })

    const first = call('toggleHeartVote', heartTap('profile.alice'))
    const second = call('toggleHeartVote', heartTap('profile.bob'))

    // 在途写未完成前不并行发起；本地红心已即时移到 bob。
    expect(eventsModule.setHeart).toHaveBeenCalledTimes(1)
    expect((page.data.heart as HeartState).target?.profileRef).toBe('profile.bob')

    resolveFirst(heart(4, alice))
    await Promise.all([first, second])

    // 第二次意图以服务端最新版本继续同步，最终收敛到 bob。
    expect(eventsModule.setHeart).toHaveBeenCalledTimes(2)
    expect(eventsModule.setHeart).toHaveBeenLastCalledWith(EVENT_ID, 'ticket-bob', 4)
    expect((page.data.heart as HeartState).target?.profileRef).toBe('profile.bob')
    expect((page.data.heart as HeartState).version).toBe(5)
  })

  it('votes with the heart ticket and applies the server-authoritative state', async () => {
    const target = candidate('ticket-p1')
    eventsModule.setHeart.mockResolvedValue({
      ...heart(4, target),
      counts: { myInterestCount: 1, receivedInterestCount: 0 },
    })
    const { page, call } = mount({
      heartState: 'ready',
      eventId: EVENT_ID,
      heart: heart(3),
      candidates: [candidate('p1')],
      items: [],
      displayItems: [{ profileRef: 'profile.p1', heartTicket: 'ticket-p1' }],
    })

    await call('toggleHeartVote', heartTap('profile.p1'))

    expect(eventsModule.setHeart).toHaveBeenCalledWith(EVENT_ID, 'ticket-p1', 3)
    expect(page.data.heartMineCount).toBe(1)
    expect(showToast).toHaveBeenCalledWith({ title: '已心动', icon: 'success' })
    expect(eventsModule.patchEventInteractionSummary).toHaveBeenCalledWith(
      EVENT_ID,
      { myInterestCount: 1, receivedInterestCount: 0 },
    )
  })

  it('cancels by selected fact instead of resubmitting the same ticket', async () => {
    const voted = candidate('ticket-p1')
    eventsModule.setHeart.mockResolvedValue(heart(4))
    const { page, call } = mount({
      heartState: 'ready',
      eventId: EVENT_ID,
      heart: heart(3, voted),
      candidates: [{ ...voted, selected: true }],
      items: [],
      displayItems: [{ profileRef: voted.profileRef, heartTicket: 'ticket-p1' }],
    })

    await call('toggleHeartVote', heartTap(voted.profileRef))

    expect(eventsModule.setHeart).toHaveBeenCalledWith(EVENT_ID, null, 3)
    expect(page.data.sentItems).toEqual([])
    expect(showToast).toHaveBeenCalledWith({ title: '已取消心动', icon: 'success' })
  })

  it('refreshes the authoritative heart state on version conflict', async () => {
    eventsModule.setHeart.mockRejectedValue(new MipEventsError('CONFLICT', 'heart version drift', true))
    eventsModule.listHeartCandidates.mockResolvedValue([candidate('p1')])
    eventsModule.getHeart.mockResolvedValue(heart(9))
    const { page, call } = mount({
      heartState: 'ready',
      eventId: EVENT_ID,
      heart: heart(3),
      candidates: [candidate('p1')],
      items: [],
      displayItems: [{ profileRef: 'profile.p1', heartTicket: 'ticket-p1' }],
    })

    await call('toggleHeartVote', heartTap('profile.p1'))

    expect(page.data.heartState).toBe('ready')
    expect((page.data.heart as HeartState).version).toBe(9)
    expect((page.data.heart as HeartState).target).toBeUndefined()
  })

  it('moves a stale ready page into restricted when the server denies the mutation', async () => {
    eventsModule.setHeart.mockRejectedValue(new MipEventsError('FORBIDDEN', 'not attended', false))
    const { page, call } = mount({
      heartState: 'ready',
      eventId: EVENT_ID,
      heart: heart(3),
      candidates: [candidate('p1')],
      items: [],
      displayItems: [{ profileRef: 'profile.p1', heartTicket: 'ticket-p1' }],
    })

    await call('toggleHeartVote', heartTap('profile.p1'))

    expect(page.data.heartState).toBe('restricted')
    expect(page.data.heart).toBeNull()
    expect(page.data.heartMineCount).toBe(0)
    expect(showToast).toHaveBeenCalledWith({ title: ATTENDANCE_TOAST, icon: 'none' })
  })

  it('treats identity access requirements as restricted instead of surfaced errors', async () => {
    eventsModule.setHeart.mockRejectedValue(new MipEventsError('PHONE_REQUIRED', 'phone required', false))
    const { page, call } = mount({
      heartState: 'ready',
      eventId: EVENT_ID,
      heart: heart(3),
      candidates: [candidate('p1')],
      items: [],
      displayItems: [{ profileRef: 'profile.p1', heartTicket: 'ticket-p1' }],
    })

    await call('toggleHeartVote', heartTap('profile.p1'))

    expect(page.data.heartState).toBe('restricted')
    expect(showToast).toHaveBeenCalledWith({ title: ATTENDANCE_TOAST, icon: 'none' })
  })

  it('rolls back to the last server heart when the save fails without a newer intent', async () => {
    eventsModule.setHeart.mockRejectedValue(new Error('网络开小差'))
    eventsModule.listHeartCandidates.mockResolvedValue([candidate('p1')])
    eventsModule.getHeart.mockResolvedValue({ ...heart(3), counts: { myInterestCount: 0, receivedInterestCount: 0 } })
    const { page, call } = mount({
      heartState: 'ready',
      eventId: EVENT_ID,
      heart: null,
      candidates: [],
      items: [],
      displayItems: [{ profileRef: 'profile.p1', heartTicket: 'ticket-p1' }],
    })

    // 先建立服务端事实基准，再让写入失败。
    await call('loadHeartState')
    expect(page.data.heartState).toBe('ready')

    await call('toggleHeartVote', heartTap('profile.p1'))

    // 乐观翻转被回滚到最后一次服务端事实，并给出失败提示。
    expect((page.data.heart as HeartState).target).toBeUndefined()
    expect((page.data.heart as HeartState).version).toBe(3)
    expect(page.data.heartMineCount).toBe(0)
    expect(page.data.heartPulseRef).toBe('')
    expect(showToast).toHaveBeenLastCalledWith({ title: '网络开小差', icon: 'none' })
  })
})
