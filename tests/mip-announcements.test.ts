import { describe, expect, it, vi } from 'vitest'
import { createAnnouncementGateway } from '../src/modules/mip-announcements/gateway'

const item = {
  id: '50000000-0000-4000-8000-000000000005',
  title: '活动安排调整',
  summary: '本周活动时间已经更新。',
  isPinned: true,
  publishedAt: '2026-08-24T08:00:00.000Z',
  scopeType: 'BRANCH',
  branchName: '深圳分会',
  targetType: 'EVENT',
  targetId: '60000000-0000-4000-8000-000000000006',
}

describe('MIP announcements gateway', () => {
  it('requests a branch-scoped public page and parses only presentation fields', async () => {
    const invoke = vi.fn(async () => ({ items: [item], nextCursor: '20' }))
    const gateway = createAnnouncementGateway({ invoke })
    await expect(gateway.list({ branchId: 'branch-id', limit: 20 })).resolves.toEqual({
      items: [item],
      nextCursor: '20',
    })
    expect(invoke).toHaveBeenCalledWith('listAnnouncements', { branchId: 'branch-id', limit: 20 })
  })

  it('parses detail content and rejects a partial target reference', async () => {
    const gateway = createAnnouncementGateway({
      invoke: vi.fn(async () => ({ ...item, body: '活动开始时间调整为周六下午。' })),
    })
    await expect(gateway.get(item.id)).resolves.toMatchObject({ id: item.id, body: '活动开始时间调整为周六下午。' })

    const invalid = createAnnouncementGateway({
      invoke: vi.fn(async () => ({ ...item, targetId: undefined, body: '正文' })),
    })
    await expect(invalid.get(item.id)).rejects.toThrow('公告服务返回了无效响应')
  })
})
