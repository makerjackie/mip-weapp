import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { MipEventsError } from '../src/modules/mip-events'

const eventsModule = vi.hoisted(() => ({
  getEvent: vi.fn(),
  getFeedback: vi.fn(),
  saveFeedback: vi.fn(),
}))

vi.mock('../src/modules/mip-events/client', () => ({
  mipEventsModule: eventsModule,
}))

vi.mock('../src/modules/mip-identity/client', () => ({
  mipIdentityModule: {
    beginProtectedAction: vi.fn(),
    consumePendingResume: vi.fn(),
  },
}))

vi.mock('../src/platform/navigation/client', () => ({
  caseNavigateTo: vi.fn(),
}))

type PageData = Record<string, any>
type PageDefinition = Record<string, any> & {
  data: PageData
  setData: (patch: PageData) => void
}

const eventId = '60000000-0000-4000-8000-000000000001'
const eventDetail = {
  id: eventId,
  title: '测试活动',
  eventTypeLabel: '早会',
  accessType: 'MEMBER_INCLUDED',
  startsAt: '2026-09-03T02:00:00.000Z',
  endsAt: '2026-09-03T04:00:00.000Z',
  cityName: '深圳',
  venueName: '测试场地',
  mode: 'OFFLINE',
}
const answers = {
  recommendation: 'RECOMMEND',
  roleKeys: ['connector'],
  joinIntent: 'JOIN_NOW',
  explorationMethods: ['ATTEND_EVENT'],
  rosterConsent: 'MATCH_OPPORTUNITIES',
}

let definition: PageDefinition
const showToast = vi.fn()

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

beforeAll(async () => {
  vi.stubGlobal('wx', { showToast })
  vi.stubGlobal('Page', (input: PageDefinition) => {
    definition = input
  })
  await import('../src/packages/member/mip-events/feedback/index')
})

beforeEach(() => {
  for (const mock of Object.values(eventsModule)) {
    mock.mockReset()
  }
  showToast.mockClear()
})

describe('MIP event feedback UI state', () => {
  it('keeps legacy rating and body while requiring the new structured answers', async () => {
    const page = createPage({ eventId })
    page.accessReady = true
    eventsModule.getEvent.mockResolvedValue(eventDetail)
    eventsModule.getFeedback.mockResolvedValue({
      id: 'feedback-legacy',
      rating: 4,
      body: '旧反馈',
      answers: null,
      version: 2,
    })

    await callPage(page, 'loadFeedback')

    expect(page.data.state).toBe('ready')
    expect(page.data.rating).toBe(4)
    expect(page.data.body).toBe('旧反馈')
    expect(page.data.recommendation).toBe('')
    expect(page.data.roleOptions.every((role: { selected: boolean }) => !role.selected)).toBe(true)
    expect(Reflect.apply(page.validationMessage, page, [])).toBe('请选择是否愿意推荐 MIP。')
  })

  it('saves every structured field and applies the authoritative response', async () => {
    const page = createPage({
      eventId,
      event: eventDetail,
      state: 'ready',
      feedback: { id: 'feedback-1', version: 2 },
      rating: 5,
      recommendation: 'RECOMMEND',
      roleOptions: definition.data.roleOptions.map((role: { key: string }) => ({
        ...role,
        selected: role.key === 'connector',
      })),
      body: '  有合作资源  ',
      joinIntent: 'JOIN_NOW',
      explorationOptions: definition.data.explorationOptions.map((item: { key: string }) => ({
        ...item,
        selected: item.key === 'ATTEND_EVENT',
      })),
      rosterConsent: 'MATCH_OPPORTUNITIES',
    })
    const authoritativeAnswers = { ...answers, roleKeys: ['strategist'] }
    eventsModule.saveFeedback.mockResolvedValue({
      id: 'feedback-1',
      rating: 5,
      body: '有合作资源',
      answers: authoritativeAnswers,
      version: 3,
    })

    await callPage(page, 'submitFeedback')

    expect(eventsModule.saveFeedback).toHaveBeenCalledWith(eventId, {
      rating: 5,
      body: '有合作资源',
      answers,
      expectedVersion: 2,
    })
    expect(page.data.feedback.version).toBe(3)
    expect(page.data.roleOptions.find((role: { key: string }) => role.key === 'strategist').selected).toBe(true)
    expect(page.data.roleOptions.find((role: { key: string }) => role.key === 'connector').selected).toBe(false)
    expect(showToast).toHaveBeenCalledWith({ title: '反馈已保存', icon: 'success' })
  })

  it('refreshes only the optimistic version after a conflict and preserves the draft', async () => {
    const page = createPage({
      eventId,
      event: eventDetail,
      state: 'ready',
      feedback: { id: 'feedback-1', version: 2 },
      rating: 5,
      recommendation: 'RECOMMEND',
      roleOptions: definition.data.roleOptions.map((role: { key: string }) => ({
        ...role,
        selected: role.key === 'connector',
      })),
      body: '需要保留的草稿',
      joinIntent: 'JOIN_NOW',
      explorationOptions: definition.data.explorationOptions,
      rosterConsent: 'PRIVATE',
    })
    eventsModule.saveFeedback.mockRejectedValue(new MipEventsError('CONFLICT', '反馈已变化'))
    eventsModule.getFeedback.mockResolvedValue({
      id: 'feedback-1',
      rating: 3,
      body: '服务端内容',
      answers,
      version: 4,
    })

    await callPage(page, 'submitFeedback')

    expect(page.data.state).toBe('conflict')
    expect(page.data.feedback.version).toBe(4)
    expect(page.data.body).toBe('需要保留的草稿')
    expect(page.data.message).toContain('当前填写内容已保留')
  })

  it('shows the attendee requirement without adding an event-end restriction', async () => {
    const page = createPage({ eventId })
    page.accessReady = true
    eventsModule.getEvent.mockResolvedValue(eventDetail)
    eventsModule.getFeedback.mockRejectedValue(new MipEventsError('FORBIDDEN', '尚未签到'))

    await callPage(page, 'loadFeedback')

    expect(page.data.state).toBe('blocked')
    expect(page.data.message).toBe('完成签到后可填写本场活动反馈。')
  })
})
