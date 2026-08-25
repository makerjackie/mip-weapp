import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import {
  canResumeEventCommentMutation,
  retainEventCommentDeleteIntent,
  retainEventCommentReportIntent,
  retainEventCommentSubmissionIntent,
} from '../src/modules/mip-community/event-comment-intent'
import { createMipCommunityGateway } from '../src/modules/mip-community/gateway'

function read(path: string) {
  return readFileSync(path, 'utf8')
}

describe('MIP event comments vertical contract', () => {
  it('reuses the generic EVENT comment schema without a new migration', () => {
    const migration = read('database/mysql/mip/036_mip_knowledge_content.sql')
    expect(migration).toContain('target_type IN (\'KNOWLEDGE\', \'EVENT\', \'OPPORTUNITY\')')
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS mip_content_comments')
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS mip_content_comment_reports')
  })

  it('keeps event visibility, author, status, scope and blocks server-authoritative', () => {
    const server = read('cloudfunctions/mip-community-api/domain/event-comments.js')
    const cloudConfig = read('cloudfunctions/mip-community-api/config.json')
    expect(server).toContain('settings.target_type = \'EVENT\'')
    expect(server).toContain('event.status = \'PUBLISHED\'')
    expect(server).toContain('event.published_at IS NOT NULL')
    expect(server).toContain('event.status IN (\'CANCELLED\', \'ENDED\')')
    expect(server).toContain('mip_user_blocks')
    expect(server).toContain('comment.author_user_id === caller.userId')
    expect(server).toContain('authorize: queryable => requireReady(queryable, caller)')
    expect(server).toContain('target_type = \'EVENT\'')
    expect(server).not.toContain('input.ownerUserId')
    expect(server).not.toContain('input.status')
    expect(server).not.toContain('input.scopeType')
    expect(cloudConfig).toContain('security.msgSecCheck')
  })

  it('exposes the member route from the event detail with complete page states', () => {
    const app = read('src/app.json')
    const detail = read('src/packages/member/mip-events/detail/index.ts')
    const detailView = read('src/packages/member/mip-events/detail/index.wxml')
    const page = read('src/packages/member/mip-events/comments/index.ts')
    const view = read('src/packages/member/mip-events/comments/index.wxml')
    expect(app).toContain('mip-events/comments/index')
    expect(detail).toContain('/packages/member/mip-events/comments/index?eventId=')
    expect(detailView).toContain('活动评论')
    expect(page).toContain('consumePendingResume(\'packages/member/mip-events/comments/index\')')
    expect(page).toContain('resumed?.action === \'INTERACT\'')
    expect(page).toContain('[\'CONFLICT\', \'COMMENT_EDIT_WINDOW_CLOSED\']')
    for (const state of ['loading', 'access', 'error']) {
      expect(view).toContain(`state === '${state}'`)
    }
    expect(view).toContain('comments.length === 0')
    expect(view).toContain('disabled="{{!draft || submitting}}"')
    expect(view).toContain('loading="{{loadingMore}}"')
  })

  it('retains mutation identifiers until content or server version changes', () => {
    const submission = {
      eventId: 'event-1',
      body: ' 活动评论 ',
    }
    const first = retainEventCommentSubmissionIntent(null, submission, () => 'save-key-0001')
    const replay = retainEventCommentSubmissionIntent(first, { ...submission, body: '活动评论' }, () => 'save-key-0002')
    const changed = retainEventCommentSubmissionIntent(first, { ...submission, body: '另一条评论' }, () => 'save-key-0002')
    expect(replay.idempotencyKey).toBe('save-key-0001')
    expect(changed.idempotencyKey).toBe('save-key-0002')

    const deletion = { eventId: 'event-1', commentId: 'comment-1', expectedVersion: 2 }
    const deleteFirst = retainEventCommentDeleteIntent(null, deletion, () => 'delete-key-0001')
    expect(retainEventCommentDeleteIntent(deleteFirst, deletion, () => 'delete-key-0002').idempotencyKey)
      .toBe('delete-key-0001')
    expect(retainEventCommentDeleteIntent(deleteFirst, { ...deletion, expectedVersion: 3 }, () => 'delete-key-0002').idempotencyKey)
      .toBe('delete-key-0002')

    const report = {
      eventId: 'event-1',
      commentId: 'comment-1',
      expectedVersion: 2,
      category: 'SPAM' as const,
    }
    const reportFirst = retainEventCommentReportIntent(
      null,
      report,
      () => 'report-key-0001',
      () => 'report-request-0001',
    )
    const reportReplay = retainEventCommentReportIntent(
      reportFirst,
      report,
      () => 'report-key-0002',
      () => 'report-request-0002',
    )
    expect(reportReplay).toEqual(reportFirst)
    const reportAfterConflict = retainEventCommentReportIntent(
      reportFirst,
      { ...report, expectedVersion: 3 },
      () => 'report-key-0002',
      () => 'report-request-0002',
    )
    expect(reportAfterConflict.idempotencyKey).toBe('report-key-0002')
    expect(reportAfterConflict.requestId).toBe('report-request-0002')
  })

  it('resumes a pending mutation only after the refreshed server access check stays ready', () => {
    expect(canResumeEventCommentMutation(true, { kind: 'SAVE' })).toBe(true)
    expect(canResumeEventCommentMutation(false, { kind: 'SAVE' })).toBe(false)
    expect(canResumeEventCommentMutation(true, null)).toBe(false)

    const page = read('src/packages/member/mip-events/comments/index.ts')
    expect(page).toContain('canResumeEventCommentMutation(this.accessReady, this.pendingAction)')
    expect(page).toContain('canResumeEventCommentMutation(this.accessReady, pending)')
  })

  it('accepts only the public event comment DTO and sends no client-owned facts', async () => {
    const invoke = vi.fn(async (action: string) => {
      if (action === 'listEventComments') {
        return {
          event: { id: 'event-1', title: '活动', status: 'PUBLISHED' },
          settings: { commentsEnabled: true, moderationMode: 'AUTO', version: 1 },
          items: [{
            id: 'comment-1',
            body: '评论',
            status: 'PUBLISHED',
            author: { profileRef: 'p1.public-reference', nickname: '用户', headline: '', avatarUrl: '' },
            mine: false,
            canEdit: false,
            canDelete: false,
            version: 1,
            createdAt: '2026-08-25T00:00:00.000Z',
          }],
        }
      }
      return { id: 'comment-1', status: 'PUBLISHED', version: 1 }
    })
    const gateway = createMipCommunityGateway({ invoke })
    const page = await gateway.listEventComments('event-1')
    expect(page.items[0]?.author.profileRef).toBe('p1.public-reference')
    expect(JSON.stringify(page)).not.toContain('userId')

    await gateway.saveEventComment({ eventId: 'event-1', body: '评论' }, 'save-key-0001')
    expect(invoke).toHaveBeenLastCalledWith('saveEventComment', {
      eventId: 'event-1',
      body: '评论',
      idempotencyKey: 'save-key-0001',
    })
  })
})
