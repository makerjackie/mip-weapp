import type { HeartCandidate, HeartState, PublicEventParticipant } from '../src/modules/mip-events'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { MipEventsError } from '../src/modules/mip-events'

const eventsModule = vi.hoisted(() => ({
  getHeart: vi.fn(),
  listHeartCandidates: vi.fn(),
  listPublicParticipants: vi.fn(),
}))
const navigateTo = vi.hoisted(() => vi.fn())

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
  selected: boolean,
): HeartCandidate {
  return {
    participantRef: `heart-${name}`,
    profileRef: `p1.${name}`,
    nickname: name,
    selected,
  }
}

function heart(received: HeartCandidate[] = []): HeartState {
  return {
    received,
    version: 1,
  }
}

beforeAll(async () => {
  vi.stubGlobal('wx', { stopPullDownRefresh: vi.fn() })
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
})

describe('MIP event participant private heart state', () => {
  it('keeps public relations and builds sent 0/1 and received private lists', async () => {
    const selected = candidate('selected', true)
    const unselected = candidate('unselected', false)
    const received = candidate('received', false)
    const publicParticipant: PublicEventParticipant = {
      profileRef: 'p1.public',
      nickname: '公开参与人',
      heartRelation: 'MUTUAL',
    }
    const page = createPage({ eventId: '60000000-0000-4000-8000-000000000001' })
    eventsModule.listPublicParticipants.mockResolvedValueOnce({ items: [publicParticipant] })
    eventsModule.listHeartCandidates.mockResolvedValueOnce([selected, unselected])
    eventsModule.getHeart.mockResolvedValueOnce(heart([received]))

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

  it('switches the pills to real private views and keeps heart editing as an explicit action', () => {
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

    void callPage(page, 'openInteraction')
    expect(navigateTo).toHaveBeenCalledWith({
      url: '/packages/member/mip-events/interaction/index?eventId=60000000-0000-4000-8000-000000000001&viewMode=SENT',
    })
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
      eventsModule.getHeart.mockResolvedValueOnce(heart())

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
    eventsModule.getHeart.mockResolvedValueOnce(heart())

    await callPage(page, 'loadHeartState')

    expect(page.data.heartState).toBe('error')
    expect(page.data.heartMessage).toBe('活动服务暂时不可用，请稍后重试')

    eventsModule.listPublicParticipants.mockResolvedValue({ items: [] })
    eventsModule.listHeartCandidates.mockResolvedValue([])
    eventsModule.getHeart.mockResolvedValue(heart())
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
