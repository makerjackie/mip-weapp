import type { HeartCandidate, HeartState } from '../src/modules/mip-events'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { MipEventsError } from '../src/modules/mip-events'

// MIW-76：旧 interaction 页随页删除后，心动投票行为测试改钉在唯一存活面
// participants 页（J2-02 卡片右上角心形）上，覆盖 restricted/error/并发锁/
// 改选取消/CONFLICT 回刷/身份受限六类交互事实。

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

  it('ignores taps while a heart mutation is already in flight', async () => {
    const { page, call } = mount({ heartState: 'ready', savingHeart: true, eventId: EVENT_ID })

    await call('toggleHeartVote', heartTap('profile.p1'))

    expect(eventsModule.setHeart).not.toHaveBeenCalled()
    expect(page.data.savingHeart).toBe(true)
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
    expect(page.data.savingHeart).toBe(false)
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
    expect(page.data.savingHeart).toBe(false)
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
    expect(page.data.savingHeart).toBe(false)
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
    expect(showToast).toHaveBeenCalledWith({ title: ATTENDANCE_TOAST, icon: 'none' })
    expect(page.data.savingHeart).toBe(false)
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
    expect(page.data.savingHeart).toBe(false)
  })
})
