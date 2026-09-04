import type { HeartCandidate, HeartState } from '../src/modules/mip-events'
import fs from 'node:fs'
import path from 'node:path'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { MipEventsError } from '../src/modules/mip-events'

const root = path.resolve(import.meta.dirname, '..')
const interactionView = fs.readFileSync(
  path.join(root, 'src/packages/member/mip-events/interaction/index.wxml'),
  'utf8',
)

const eventsModule = vi.hoisted(() => ({
  getFeedback: vi.fn(),
  getHeart: vi.fn(),
  listHeartCandidates: vi.fn(),
  saveFeedback: vi.fn(),
  setHeart: vi.fn(),
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

type PageData = Record<string, unknown>
type PageDefinition = Record<string, unknown> & {
  data: PageData
  setData: (patch: PageData) => void
}

let definition: PageDefinition
const showToast = vi.fn()

function record(value: unknown): value is PageData {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function setPath(target: PageData, path: string, value: unknown) {
  const parts = path.split('.')
  const leaf = parts.pop()
  if (!leaf) {
    return
  }
  let cursor = target
  for (const part of parts) {
    if (!record(cursor[part])) {
      cursor[part] = {}
    }
    cursor = cursor[part] as PageData
  }
  cursor[leaf] = value
}

function createPage(overrides: PageData = {}) {
  const page = Object.create(definition) as PageDefinition
  page.data = { ...structuredClone(definition.data), ...structuredClone(overrides) }
  page.setData = (patch) => {
    for (const [path, value] of Object.entries(patch)) {
      setPath(page.data, path, value)
    }
  }
  return page
}

function callPage(page: PageDefinition, method: string, ...args: unknown[]) {
  const handler = page[method]
  if (typeof handler !== 'function') {
    throw new TypeError(`Missing page method: ${method}`)
  }
  return Reflect.apply(handler, page, args) as Promise<unknown>
}

function candidate(participantRef: string, selected: boolean): HeartCandidate {
  return {
    nickname: participantRef,
    participantRef,
    profileRef: `p1.${participantRef}`,
    selected,
  }
}

function heart(version: number, targetRef?: string): HeartState {
  return {
    received: [],
    targetRef,
    version,
  }
}

beforeAll(async () => {
  vi.stubGlobal('wx', { showToast })
  vi.stubGlobal('Page', (input: PageDefinition) => {
    definition = input
  })
  await import('../src/packages/member/mip-events/interaction/index')
})

beforeEach(() => {
  for (const mock of Object.values(eventsModule)) {
    mock.mockReset()
  }
  showToast.mockClear()
})

describe('MIP event heart UI state', () => {
  it('uses a selection label and keeps the selected count visible', () => {
    expect(interactionView).toContain('>选择心动 {{heart.targetRef ? 1 : 0}}</view>')
    expect(interactionView).not.toContain('>我的心动 {{heart.targetRef ? 1 : 0}}</view>')
  })

  it('renders attendance failures as a blocked state', async () => {
    eventsModule.listHeartCandidates.mockRejectedValueOnce(
      new MipEventsError('FORBIDDEN', '完成签到后可以使用本场互动'),
    )
    eventsModule.getHeart.mockResolvedValueOnce(heart(1))
    eventsModule.getFeedback.mockResolvedValueOnce(null)
    const page = createPage({ eventId: '60000000-0000-4000-8000-000000000001' })

    await callPage(page, 'loadInteraction')

    expect(page.data.state).toBe('blocked')
    expect(page.data.errorDescription).toBe('完成签到后可使用活动互动功能。')
    expect(interactionView).toContain('state === \'blocked\'')
    expect(interactionView).toContain('description="{{errorDescription}}"')
  })

  it('shows retryable service errors without replacing them with attendance guidance', async () => {
    const serviceMessage = '活动服务暂时不可用，请稍后重试'
    eventsModule.listHeartCandidates.mockRejectedValueOnce(
      new MipEventsError('SERVICE_UNAVAILABLE', serviceMessage, true),
    )
    eventsModule.getHeart.mockResolvedValueOnce(heart(1))
    eventsModule.getFeedback.mockResolvedValueOnce(null)
    const page = createPage({ eventId: '60000000-0000-4000-8000-000000000001' })

    await callPage(page, 'loadInteraction')

    expect(page.data.state).toBe('error')
    expect(page.data.errorDescription).toBe(serviceMessage)
    expect(interactionView).toContain('action-text="重新加载"')
    expect(interactionView).not.toContain('请确认已完成签到后重试。')
  })

  it('moves a stale ready page into the blocked state when saving is forbidden', async () => {
    const candidates = [candidate('candidate-token', false)]
    const page = createPage({
      candidates,
      eventId: '60000000-0000-4000-8000-000000000001',
      heart: heart(1),
      state: 'ready',
      visibleCandidates: candidates,
    })
    eventsModule.setHeart.mockRejectedValueOnce(
      new MipEventsError('FORBIDDEN', '完成签到后可以使用本场互动'),
    )

    await callPage(page, 'saveHeartTarget', 'candidate-token')

    expect(page.data.state).toBe('blocked')
    expect(page.data.errorDescription).toBe('完成签到后可以使用本场互动')
  })

  it('projects a successful selection from the submitted candidate token and cancels by selected fact', async () => {
    const candidateToken = 'candidate-token-with-one-expiry'
    const otherToken = 'other-candidate-token'
    const candidates = [candidate(candidateToken, false), candidate(otherToken, false)]
    const page = createPage({
      candidates,
      eventId: '60000000-0000-4000-8000-000000000001',
      heart: heart(1),
      state: 'ready',
      visibleCandidates: candidates,
    })
    eventsModule.setHeart
      .mockResolvedValueOnce(heart(2, 'heart-token-with-another-expiry'))
      .mockResolvedValueOnce(heart(3))

    await callPage(page, 'saveHeartTarget', candidateToken)

    expect(eventsModule.setHeart).toHaveBeenNthCalledWith(
      1,
      page.data.eventId,
      candidateToken,
      1,
    )
    expect(page.data.candidates).toEqual([
      candidate(candidateToken, true),
      candidate(otherToken, false),
    ])
    expect(page.data.heart).toEqual(heart(2, 'heart-token-with-another-expiry'))

    await callPage(page, 'saveHeartTarget', candidateToken)

    expect(eventsModule.setHeart).toHaveBeenNthCalledWith(
      2,
      page.data.eventId,
      null,
      2,
    )
    expect(page.data.candidates).toEqual([
      candidate(candidateToken, false),
      candidate(otherToken, false),
    ])
    expect(showToast).toHaveBeenLastCalledWith({ title: '已取消', icon: 'success' })
  })

  it('keeps authoritative candidate selection when a version conflict refreshes different tokens', async () => {
    const staleToken = 'stale-candidate-token'
    const freshFirst = candidate('fresh-candidate-token-a', false)
    const freshSelected = candidate('fresh-candidate-token-b', true)
    const page = createPage({
      candidates: [candidate(staleToken, false)],
      eventId: '60000000-0000-4000-8000-000000000001',
      heart: heart(3),
      state: 'ready',
      visibleCandidates: [candidate(staleToken, false)],
    })
    eventsModule.setHeart.mockRejectedValueOnce(
      new MipEventsError('CONFLICT', '心动状态已变化，请刷新后重试', true),
    )
    eventsModule.listHeartCandidates.mockResolvedValueOnce([freshFirst, freshSelected])
    eventsModule.getHeart.mockResolvedValueOnce(heart(4, 'heart-token-with-another-expiry'))

    await callPage(page, 'saveHeartTarget', staleToken)

    expect(page.data.candidates).toEqual([freshFirst, freshSelected])
    expect(page.data.visibleCandidates).toEqual([freshFirst, freshSelected])
    expect(page.data.message).toBe('心动状态已更新，请重新选择。')
  })
})
