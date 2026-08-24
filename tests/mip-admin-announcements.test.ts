import { describe, expect, it } from 'vitest'
import {
  parseAdminAnnouncementDetail,
  parseAdminAnnouncementPage,
  parseAdminAnnouncementScopes,
} from '../src/modules/mip-admin/announcements'

const item = {
  id: '10000000-0000-4000-8000-000000000001',
  scopeType: 'PLATFORM',
  branchId: null,
  branchName: '',
  title: '活动安排',
  summary: '本周活动安排已更新。',
  targetType: 'EVENT',
  targetId: '20000000-0000-4000-8000-000000000002',
  status: 'PUBLISHED',
  contentSafetyStatus: 'PASSED',
  isPinned: true,
  visibleFrom: '2026-08-24T08:00:00.000Z',
  visibleUntil: null,
  publishedAt: '2026-08-24T08:05:00.000Z',
  withdrawnAt: null,
  version: 2,
  updatedAt: '2026-08-24T08:05:00.000Z',
}

describe('MIP admin announcement response contracts', () => {
  it('parses bounded summary and detail responses', () => {
    expect(parseAdminAnnouncementPage({ items: [item], nextCursor: null }).items[0]?.title)
      .toBe('活动安排')
    expect(parseAdminAnnouncementDetail({ ...item, body: '活动详情。' }).body).toBe('活动详情。')
  })

  it('rejects extra fields and malformed target pairs', () => {
    expect(() => parseAdminAnnouncementPage({
      items: [{ ...item, internalActorId: 'hidden' }],
      nextCursor: null,
    })).toThrow('无效的公告信息')
    expect(() => parseAdminAnnouncementDetail({ ...item, body: '正文', targetId: null }))
      .toThrow('无效的公告信息')
  })

  it('parses only bounded editable scopes', () => {
    expect(parseAdminAnnouncementScopes({
      platform: true,
      branches: [{ id: '30000000-0000-4000-8000-000000000003', name: '深圳分会' }],
    })).toEqual({
      platform: true,
      branches: [{ id: '30000000-0000-4000-8000-000000000003', name: '深圳分会' }],
    })
    expect(() => parseAdminAnnouncementScopes({ platform: true, branches: [], roleKey: 'OWNER' }))
      .toThrow('无效的公告范围')
  })
})
