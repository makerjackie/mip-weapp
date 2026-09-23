import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const events = vi.hoisted(() => ({ listHeartHistory: vi.fn(), markHeartHistoryRead: vi.fn() }))
vi.mock('../src/modules/mip-events/client', () => ({ mipEventsModule: events }))
vi.mock('../src/modules/mip-identity/client', () => ({
  mipIdentityModule: { beginProtectedAction: vi.fn(), consumePendingResume: vi.fn() },
}))
vi.mock('../src/platform/navigation/client', () => ({ caseNavigateTo: vi.fn() }))

type PageInstance = Record<string, any>
let definition: PageInstance

function page() {
  const result = Object.create(definition)
  result.data = structuredClone(definition.data)
  result.cache = structuredClone(definition.cache)
  result.setData = (patch: Record<string, unknown>, callback?: () => void) => {
    Object.assign(result.data, patch)
    callback?.()
  }
  return result as PageInstance
}

function response(kind = 'RECEIVED', readThroughAt = '2026-09-22T10:00:00.000Z') {
  return {
    kind,
    totalCount: 1,
    unreadCount: kind === 'RECEIVED' ? 1 : 0,
    readThroughAt,
    hasMore: false,
    items: [{
      event: { id: 'event-1', title: '城市聚会', startsAt: '2026-09-20T10:00:00.000Z', endsAt: '2026-09-20T12:00:00.000Z' },
      person: { profileRef: 'p1.opaque', nickname: '设计伙伴', headline: '品牌设计' },
      updatedAt: '2026-09-21T10:00:00.000Z',
    }],
  }
}

beforeAll(async () => {
  vi.stubGlobal('Page', (value: PageInstance) => {
    definition = value
  })
  await import('../src/packages/member/mip-hearts/index')
})

beforeEach(() => {
  vi.clearAllMocks()
  events.markHeartHistoryRead.mockResolvedValue({ readAt: '2026-09-22T10:00:00.000Z' })
})

describe('activity heart history page contract', () => {
  it('renders server people and clears received unread on successful page entry, including the default sent tab', async () => {
    const instance = page()
    events.listHeartHistory.mockImplementation(async kind => response(kind))
    await instance.load('SENT', true)
    await instance.load('RECEIVED', true)
    await vi.waitFor(() => expect(events.markHeartHistoryRead).toHaveBeenCalledWith('2026-09-22T10:00:00.000Z'))
    expect(instance.data.items[0]).toMatchObject({ person: { nickname: '设计伙伴', headline: '品牌设计' } })
    expect(instance.data.receivedUnreadCount).toBe(0)
    expect(instance.cache.RECEIVED.items).toHaveLength(1)
  })

  it('does not mark a hidden page read and preserves loaded people if marking fails', async () => {
    const instance = page()
    instance.data.kind = 'RECEIVED'
    instance.pageHidden = true
    events.listHeartHistory.mockResolvedValue(response())
    await instance.load('RECEIVED', true)
    expect(events.markHeartHistoryRead).not.toHaveBeenCalled()
    expect(instance.data.receivedUnreadCount).toBe(1)
    instance.pageHidden = false
    events.markHeartHistoryRead.mockRejectedValueOnce(new Error('network'))
    await instance.markReceivedRead()
    expect(instance.data.state).toBe('ready')
    expect(instance.data.items).toHaveLength(1)
    expect(instance.data.receivedUnreadCount).toBe(1)
    expect(instance.data.message).toContain('未读标记暂未更新')
  })

  it('ignores an older load completing after a newer refresh', async () => {
    const instance = page()
    instance.data.kind = 'RECEIVED'
    instance.pageHidden = true
    let completeFirst!: (value: ReturnType<typeof response>) => void
    events.listHeartHistory.mockReturnValueOnce(new Promise((resolve) => {
      completeFirst = resolve
    }))
    const first = instance.load('RECEIVED', true)
    const newer = response('RECEIVED', '2026-09-22T11:00:00.000Z')
    newer.items[0].person.nickname = '刷新后的伙伴'
    events.listHeartHistory.mockResolvedValueOnce(newer)
    await instance.load('RECEIVED', true)
    completeFirst(response())
    await first
    expect(instance.data.items[0].person.nickname).toBe('刷新后的伙伴')
    expect(instance.cache.RECEIVED.readThroughAt).toBe('2026-09-22T11:00:00.000Z')
  })
})
