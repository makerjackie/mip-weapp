import type { AdminRequest } from '../src/modules/mip-admin/request-contract'
import type { MipAdminError } from '../src/modules/mip-admin/types'
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { createMipAdminGateway } from '../src/modules/mip-admin/cloudbase-gateway'
import { activeAdminWorkspaceItemKey } from '../src/packages/admin/components/workspace-nav/model'

vi.mock('../src/modules/platform/cloudbase', () => ({
  requireCloudClient: vi.fn(),
}))

vi.mock('../src/config/runtime', () => ({
  runtimeConfig: { cloudbase: { adminFunctionName: 'mip-admin-api' } },
}))

const EVENT_ID = '20000000-0000-4000-8000-000000000001'
const COMMENT_ID = '30000000-0000-4000-8000-000000000001'
const REPORT_ID = '40000000-0000-4000-8000-000000000001'

function read(path: string) {
  return readFileSync(path, 'utf8')
}

function validState() {
  return {
    event: { id: EVENT_ID, title: '长期活动', status: 'PUBLISHED', version: 2 },
    settings: { commentsEnabled: true, moderationMode: 'REVIEW', version: 1 },
    comments: [{
      id: COMMENT_ID,
      authorNickname: '玩家甲',
      body: '活动评论',
      status: 'PENDING',
      version: 1,
      createdAt: '2030-01-01T00:00:00.000Z',
      editedAt: null,
    }],
    reports: [{
      id: REPORT_ID,
      commentId: COMMENT_ID,
      commentAuthorNickname: '玩家甲',
      commentBody: '活动评论',
      commentStatus: 'PENDING',
      reporterNickname: '玩家乙',
      category: 'SPAM',
      description: '',
      status: 'PENDING',
      version: 1,
      claimedByMe: false,
      createdAt: '2030-01-02T00:00:00.000Z',
      reviewedAt: null,
    }],
  }
}

describe('MIP admin event comment contract', () => {
  it('uses the neutral v1 actions and accepts only strict event comment DTOs', async () => {
    const requests: AdminRequest[] = []
    const request = vi.fn(async <T>(value: AdminRequest) => {
      requests.push(value)
      if (value.action === 'mip.admin.events.comments.get') {
        return validState() as T
      }
      if (value.action === 'mip.admin.events.comments.settings.save') {
        return { commentsEnabled: false, moderationMode: 'AUTO', version: 2 } as T
      }
      if (value.action === 'mip.admin.events.comments.moderate') {
        return { id: COMMENT_ID, status: 'PUBLISHED', version: 2 } as T
      }
      if (value.action === 'mip.admin.events.comments.reports.claim') {
        return { id: REPORT_ID, status: 'REVIEWING', version: 2 } as T
      }
      return { id: REPORT_ID, status: 'DISMISSED', version: 3 } as T
    })
    const gateway = createMipAdminGateway({ request })

    expect((await gateway.getEventCommentAdminState(EVENT_ID)).event.id).toBe(EVENT_ID)
    await gateway.saveEventCommentSettings({
      eventId: EVENT_ID,
      expectedVersion: 1,
      settings: { commentsEnabled: false, moderationMode: 'AUTO' },
    })
    await gateway.moderateEventComment({
      eventId: EVENT_ID,
      commentId: COMMENT_ID,
      expectedVersion: 1,
      action: 'PUBLISH',
      reason: '审核通过',
    })
    await gateway.claimEventCommentReport({ eventId: EVENT_ID, reportId: REPORT_ID, expectedVersion: 1 })
    await gateway.closeEventCommentReport({
      eventId: EVENT_ID,
      reportId: REPORT_ID,
      expectedVersion: 2,
      decision: 'DISMISSED',
      reason: '证据不足',
    })

    expect(requests.map(item => item.action)).toEqual([
      'mip.admin.events.comments.get',
      'mip.admin.events.comments.settings.save',
      'mip.admin.events.comments.moderate',
      'mip.admin.events.comments.reports.claim',
      'mip.admin.events.comments.reports.close',
    ])
    expect(requests.every(item => item.contractVersion === 1)).toBe(true)
    expect(requests[2]?.input).toEqual({
      eventId: EVENT_ID,
      commentId: COMMENT_ID,
      expectedVersion: 1,
      action: 'PUBLISH',
      reason: '审核通过',
    })
  })

  it('rejects extra, cross-event, and malformed response facts', async () => {
    const extra = createMipAdminGateway({
      request: async <T>() => ({ ...validState(), scopeType: 'PLATFORM' }) as T,
    })
    await expect(extra.getEventCommentAdminState(EVENT_ID)).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    } satisfies Partial<MipAdminError>)

    const crossEvent = createMipAdminGateway({
      request: async <T>() => ({
        ...validState(),
        event: { ...validState().event, id: '20000000-0000-4000-8000-000000000002' },
      }) as T,
    })
    await expect(crossEvent.getEventCommentAdminState(EVENT_ID)).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    } satisfies Partial<MipAdminError>)

    const leaked = createMipAdminGateway({
      request: async <T>() => ({
        ...validState(),
        reports: [{ ...validState().reports[0], reviewedByUserId: 'internal-user' }],
      }) as T,
    })
    await expect(leaked.getEventCommentAdminState(EVENT_ID)).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    } satisfies Partial<MipAdminError>)

    const invalidClaim = createMipAdminGateway({
      request: async <T>() => ({ id: REPORT_ID, status: 'RESOLVED', version: 2 }) as T,
    })
    await expect(invalidClaim.claimEventCommentReport({
      eventId: EVENT_ID,
      reportId: REPORT_ID,
      expectedVersion: 1,
    })).rejects.toMatchObject({ code: 'INVALID_RESPONSE' } satisfies Partial<MipAdminError>)
  })

  it('keeps the event comment route scoped to the event console', () => {
    const app = JSON.parse(read('src/app.json')) as {
      pages: string[]
      subPackages: Array<{ root: string, pages: string[] }>
    }
    const admin = app.subPackages.find(item => item.root === 'packages/admin')
    const totalRoutes = app.pages.length
      + app.subPackages.reduce((total, item) => total + item.pages.length, 0)
    const consoleSource = read('src/packages/admin/event-console/index.ts')
    const consoleView = read('src/packages/admin/event-console/index.wxml')
    const page = read('src/packages/admin/event-comments/index.ts')
    const view = read('src/packages/admin/event-comments/index.wxml')
    const runtime = read('config/runtime-pages.json')

    expect(admin?.pages).toContain('event-comments/index')
    expect(admin?.pages).toHaveLength(41)
    expect(totalRoutes).toBe(100)
    expect(consoleSource).toContain('hasScopedCapability(session.capabilities, \'events.comments.manage\', scope)')
    expect(consoleSource).toContain('\'event-comments\'')
    expect(consoleView).toContain('data-page="event-comments"')
    expect(activeAdminWorkspaceItemKey('/packages/admin/event-comments/index?eventId=test'))
      .toBe('managed-events')
    expect(runtime).toContain('"id": "A38"')
    expect(runtime).toContain('"path": "packages/admin/event-comments/index"')

    for (const state of ['loading', 'error', 'conflict', 'forbidden']) {
      expect(view).toContain(`state === '${state}'`)
    }
    expect(view).toContain('comments.length')
    expect(view).toContain('reports.length')
    expect(page).toContain('await this.load(true)')
    expect(page).toContain('error.code === \'INVALID_STATE\'')
  })
})
