import type { HeartCandidate, HeartState, PublicEventParticipant } from '../src/modules/mip-events'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { MipEventsError } from '../src/modules/mip-events'

const eventsModule = vi.hoisted(() => ({
  getHeart: vi.fn(),
  listHeartCandidates: vi.fn(),
  listPublicParticipants: vi.fn(),
  setHeart: vi.fn(),
}))
const navigateTo = vi.hoisted(() => vi.fn())
const showToast = vi.hoisted(() => vi.fn())

vi.mock('../src/modules/mip-events/client', () => ({
  mipEventsModule: eventsModule,
}))

vi.mock('../src/platform/navigation/client', () => ({
  caseNavigateTo: navigateTo,
}))

type PageData = Record<string, unknown>
type PageDefinition = Record<string, unknown> & {
  data: PageData
  setData: (patch: PageData) => void
}

let definition: PageDefinition

function createPage(overrides: PageData = {}) {
  const page = Object.create(definition) as PageDefinition
  page.data = { ...structuredClone(definition.data), ...structuredClone(overrides) }
  page.setData = patch => Object.assign(page.data, patch)
  return page
}

function callPage(page: PageDefinition, method: string, ...args: unknown[]) {
  const handler = page[method]
  if (typeof handler !== 'function') {
    throw new TypeError(`Missing page method: ${method}`)
  }
  return Reflect.apply(handler, page, args) as Promise<unknown>
}

function candidate(
  name: string,
  selected = false,
): HeartCandidate {
  return {
    participantRef: `heart-${name}`,
    profileRef: `p1.${name}`,
    nickname: name,
    selected,
  }
}

function heartState(target?: HeartCandidate, received: HeartCandidate[] = []): HeartState {
  return {
    targetRef: target?.participantRef,
    target,
    received,
    version: 1,
  }
}

beforeAll(async () => {
  vi.stubGlobal('wx', { stopPullDownRefresh: vi.fn(), showToast })
  vi.stubGlobal('Page', (input: PageDefinition) => {
    definition = input
  })
  await import('../src/packages/member/mip-events/participants/index')
})

beforeEach(() => {
  for (const mock of Object.values(eventsModule)) {
    mock.mockReset()
  }
  navigateTo.mockReset()
  showToast.mockReset()
})

describe('MIP event participant private heart state', () => {
  it('keeps public relations and builds sent 0/1 and received private lists from the server heart', async () => {
    const selected = candidate('selected', true)
    const receivedPerson = candidate('received')
    const publicParticipant: PublicEventParticipant = {
      profileRef: 'p1.public',
      nickname: '公开参与人',
      heartRelation: 'MUTUAL',
    }
    const page = createPage({ eventId: '60000000-0000-4000-8000-000000000001' })
    eventsModule.listPublicParticipants.mockResolvedValueOnce({ items: [publicParticipant] })
    eventsModule.listHeartCandidates.mockResolvedValueOnce([selected, candidate('other')])
    eventsModule.getHeart.mockResolvedValueOnce(heartState(selected, [receivedPerson]))

    await callPage(page, 'loadPage')

    expect(page.data.state).toBe('ready')
    expect(page.data.heartState).toBe('ready')
    expect(page.data.displayItems).toEqual([
      expect.objectContaining({ displayName: '公开参与人', heartRelation: 'MUTUAL' }),
    ])
    expect(page.data.sentItems).toEqual([
      expect.objectContaining({ displayName: 'selected', heartRelation: 'SENT' }),
    ])
    expect(page.data.receivedItems).toEqual([
      expect.objectContaining({ displayName: 'received', heartRelation: 'RECEIVED' }),
    ])
  })

  it('switches the pills between the four tabs and derives the entry tab from the route', () => {
    const sentItems = [{ profileRef: 'p1.sent', displayName: '已选择', kindLabel: '', metaText: '', introductionText: '', heartRelation: 'SENT' }]
    const receivedItems = [{ profileRef: 'p1.received', displayName: '对我心动', kindLabel: '', metaText: '', introductionText: '', heartRelation: 'RECEIVED' }]
    const page = createPage({
      eventId: '60000000-0000-4000-8000-000000000001',
      heartState: 'ready',
      sentItems,
      receivedItems,
    })

    void callPage(page, 'changeView', { currentTarget: { dataset: { view: 'SENT' } } })
    expect(page.data.activeView).toBe('SENT')
    expect(page.data.displayItems).toEqual(sentItems)

    void callPage(page, 'changeView', { currentTarget: { dataset: { view: 'RECEIVED' } } })
    expect(page.data.activeView).toBe('RECEIVED')
    expect(page.data.displayItems).toEqual(receivedItems)

    // 与你互动胶囊直达（detail 页 view=SENT / view=RECEIVED；参与人数默认玩家）。
    const detailSent = createPage({ eventId: '60000000-0000-4000-8000-000000000001' })
    eventsModule.listPublicParticipants.mockResolvedValue({ items: [] })
    eventsModule.listHeartCandidates.mockResolvedValue([])
    eventsModule.getHeart.mockResolvedValue(heartState())
    void callPage(detailSent, 'onLoad', { eventId: '60000000-0000-4000-8000-000000000001', view: 'SENT' })
    expect(detailSent.data.activeView).toBe('SENT')

    const guestEntry = createPage({})
    void callPage(guestEntry, 'onLoad', { eventId: '60000000-0000-4000-8000-000000000001', view: 'PUBLIC', kind: 'GUEST' })
    expect(guestEntry.data.activeView).toBe('PUBLIC')
    expect(guestEntry.data.kind).toBe('GUEST')

    const defaultEntry = createPage({})
    void callPage(defaultEntry, 'onLoad', { eventId: '60000000-0000-4000-8000-000000000001' })
    expect(defaultEntry.data.activeView).toBe('PUBLIC')
    expect(defaultEntry.data.kind).toBe('PLAYER')
  })

  it('casts, re-targets and cancels the single per-event heart directly on the card', async () => {
    const alice = candidate('alice')
    const bob = candidate('bob')
    const page = createPage({
      eventId: '60000000-0000-4000-8000-000000000001',
      state: 'ready',
      heartState: 'ready',
      heart: heartState(),
      candidates: [alice, bob],
      items: [
        { profileRef: alice.profileRef, displayName: 'alice', kindLabel: '', metaText: '', introductionText: '', heartTicket: alice.participantRef },
        { profileRef: bob.profileRef, displayName: 'bob', kindLabel: '', metaText: '', introductionText: '', heartTicket: bob.participantRef },
      ],
      displayItems: [
        { profileRef: alice.profileRef, displayName: 'alice', kindLabel: '', metaText: '', introductionText: '', heartTicket: alice.participantRef },
        { profileRef: bob.profileRef, displayName: 'bob', kindLabel: '', metaText: '', introductionText: '', heartTicket: bob.participantRef },
      ],
    })

    // 投出：灰描边 → 红实心，「我的心动」计数 +1。
    eventsModule.setHeart.mockResolvedValueOnce(heartState(alice))
    await callPage(page, 'toggleHeartVote', { currentTarget: { dataset: { profileRef: 'p1.alice' } } })
    expect(eventsModule.setHeart).toHaveBeenCalledWith(
      '60000000-0000-4000-8000-000000000001',
      'heart-alice',
      1,
    )
    expect((page.data.heart as HeartState).target?.profileRef).toBe('p1.alice')
    expect(page.data.sentItems).toEqual([expect.objectContaining({ profileRef: 'p1.alice' })])

    // 改选：唯一红心移动到新目标，旧票由服务端改选。
    eventsModule.setHeart.mockResolvedValueOnce(heartState(bob))
    await callPage(page, 'toggleHeartVote', { currentTarget: { dataset: { profileRef: 'p1.bob' } } })
    expect(eventsModule.setHeart).toHaveBeenLastCalledWith(
      '60000000-0000-4000-8000-000000000001',
      'heart-bob',
      1,
    )
    expect(page.data.sentItems).toEqual([expect.objectContaining({ profileRef: 'p1.bob' })])

    // 再点已投红心：取消心动，计数归零。
    eventsModule.setHeart.mockResolvedValueOnce(heartState())
    await callPage(page, 'toggleHeartVote', { currentTarget: { dataset: { profileRef: 'p1.bob' } } })
    expect(eventsModule.setHeart).toHaveBeenLastCalledWith(
      '60000000-0000-4000-8000-000000000001',
      null,
      1,
    )
    expect(page.data.sentItems).toEqual([])
    expect(showToast).toHaveBeenCalledWith({ title: '已取消心动', icon: 'success' })
  })

  it('keeps heart voting gated for unattended sessions and reloads on version conflicts', async () => {
    const page = createPage({
      eventId: '60000000-0000-4000-8000-000000000001',
      state: 'ready',
      heartState: 'restricted',
      heart: null,
      candidates: [],
      items: [],
      displayItems: [],
    })
    await callPage(page, 'toggleHeartVote', { currentTarget: { dataset: { profileRef: 'p1.alice' } } })
    expect(eventsModule.setHeart).not.toHaveBeenCalled()
    expect(showToast).toHaveBeenCalledWith({ title: '完成签到后可参与心动互动。', icon: 'none' })

    // review fix：error 态灰心仍可见，点击不再静默 no-op——提示并触发心动状态重试。
    const errorPage = createPage({
      eventId: '60000000-0000-4000-8000-000000000001',
      state: 'ready',
      heartState: 'error',
      heart: null,
      heartMessage: '活动服务暂时不可用，请稍后重试',
      candidates: [],
      items: [{ profileRef: 'p1.alice', displayName: 'alice', kindLabel: '', metaText: '', introductionText: '' }],
      displayItems: [{ profileRef: 'p1.alice', displayName: 'alice', kindLabel: '', metaText: '', introductionText: '' }],
    })
    eventsModule.listHeartCandidates.mockResolvedValueOnce([candidate('alice')])
    eventsModule.getHeart.mockResolvedValueOnce(heartState())
    await callPage(errorPage, 'toggleHeartVote', { currentTarget: { dataset: { profileRef: 'p1.alice' } } })
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    expect(eventsModule.setHeart).not.toHaveBeenCalled()
    expect(showToast).toHaveBeenCalledWith({ title: '心动信息暂时不可用，正在重试。', icon: 'none' })
    expect(eventsModule.listHeartCandidates).toHaveBeenCalledOnce()
    expect(eventsModule.getHeart).toHaveBeenCalledOnce()
    expect(errorPage.data.heartState).toBe('ready')

    const conflictPage = createPage({
      eventId: '60000000-0000-4000-8000-000000000001',
      state: 'ready',
      heartState: 'ready',
      heart: heartState(),
      candidates: [candidate('alice')],
      items: [{ profileRef: 'p1.alice', displayName: 'alice', kindLabel: '', metaText: '', introductionText: '', heartTicket: 'heart-alice' }],
      displayItems: [{ profileRef: 'p1.alice', displayName: 'alice', kindLabel: '', metaText: '', introductionText: '', heartTicket: 'heart-alice' }],
    })
    eventsModule.setHeart.mockRejectedValueOnce(new MipEventsError('CONFLICT', '心动状态已变化', true))
    eventsModule.listHeartCandidates.mockResolvedValueOnce([candidate('alice')])
    eventsModule.getHeart.mockResolvedValueOnce(heartState(candidate('alice')))
    await callPage(conflictPage, 'toggleHeartVote', { currentTarget: { dataset: { profileRef: 'p1.alice' } } })
    expect(eventsModule.listHeartCandidates).toHaveBeenCalled()
    expect(conflictPage.data.heartState).toBe('ready')
  })

  it.each(['FORBIDDEN', 'AUTH_REQUIRED', 'PROFILE_REQUIRED'])(
    'presents %s as restricted access instead of a system error',
    async (code) => {
      const page = createPage({
        activeView: 'SENT',
        eventId: '60000000-0000-4000-8000-000000000001',
      })
      eventsModule.listHeartCandidates.mockRejectedValueOnce(
        new MipEventsError(code, '当前条件不满足'),
      )
      eventsModule.getHeart.mockResolvedValueOnce(heartState())

      await callPage(page, 'loadHeartState')

      expect(page.data.heartState).toBe('restricted')
      expect(page.data.heartMessage).toBe('')
      expect(page.data.displayItems).toEqual([])
    },
  )

  it('keeps service failures retryable and refreshes after returning to the page', async () => {
    const page = createPage({
      activeView: 'SENT',
      eventId: '60000000-0000-4000-8000-000000000001',
    })
    eventsModule.listHeartCandidates.mockRejectedValueOnce(
      new MipEventsError('SERVICE_UNAVAILABLE', '活动服务暂时不可用，请稍后重试', true),
    )
    eventsModule.getHeart.mockResolvedValueOnce(heartState())

    await callPage(page, 'loadHeartState')

    expect(page.data.heartState).toBe('error')
    expect(page.data.heartMessage).toBe('活动服务暂时不可用，请稍后重试')

    eventsModule.listPublicParticipants.mockResolvedValue({ items: [] })
    eventsModule.listHeartCandidates.mockResolvedValue([])
    eventsModule.getHeart.mockResolvedValue(heartState())
    void callPage(page, 'onShow')
    expect(eventsModule.listPublicParticipants).not.toHaveBeenCalled()

    void callPage(page, 'onShow')
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    expect(eventsModule.listPublicParticipants).toHaveBeenCalledOnce()
    expect(page.data.heartState).toBe('ready')
  })
})
