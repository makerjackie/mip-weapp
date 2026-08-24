import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseOpportunityCommentState } from '../src/modules/mip-admin/opportunity-comments'
import {
  retainOpportunityCommentReportIntent,
  retainOpportunityCommentSubmissionIntent,
} from '../src/modules/mip-opportunities/comment-intent'

describe('MIP opportunity comments contract', () => {
  it('keeps comments, calls, reports and settings in append-only MIP tables', () => {
    const migration = readFileSync('database/mysql/mip/034_opportunity_comments.sql', 'utf8')
    for (const table of [
      'mip_opportunity_comment_settings',
      'mip_opportunity_comments',
      'mip_opportunity_comment_calls',
      'mip_opportunity_comment_reports',
    ]) {
      expect(migration).toContain(`CREATE TABLE IF NOT EXISTS ${table}`)
    }
    expect(migration).not.toMatch(/DROP\s+TABLE/i)
    expect(migration).toContain('status IN (\'PENDING\', \'PUBLISHED\', \'HIDDEN\', \'DELETED\')')
  })

  it('exposes the complete member flow without raw user identifiers', () => {
    const server = readFileSync('cloudfunctions/mip-opportunities-api/domain/comments.js', 'utf8')
    const client = readFileSync('src/modules/mip-opportunities/client.ts', 'utf8')
    const page = readFileSync('src/packages/member/mip-opportunities/detail/index.wxml', 'utf8')
    expect(server).toContain('createProfileRef')
    expect(server).toContain('mutualBlockFilter')
    expect(server).toContain('mip_opportunity_team_members')
    expect(server).toContain('member.status = \'ACTIVE\'')
    expect(server).toContain('throw new Error(\'CALL_PARTICIPANT_REQUIRED\')')
    expect(client).toContain('\'setOpportunityCommentCall\'')
    expect(client).toContain('\'reportOpportunityComment\'')
    expect(page).toContain('评论与评价')
    expect(page).toContain('项目评价')
    expect(page).toContain('打 call')
    expect(page).toContain('commentSettings.canCall')
    expect(page).toContain('举报')
  })

  it('keeps comment and report mutation identifiers stable until success or content changes', () => {
    const submission = {
      opportunityId: 'opportunity-1',
      type: 'COMMENT' as const,
      body: '项目进展清楚。',
    }
    const firstSubmission = retainOpportunityCommentSubmissionIntent(
      null,
      submission,
      () => 'comment-submit-key-1',
    )
    const retriedSubmission = retainOpportunityCommentSubmissionIntent(
      firstSubmission,
      submission,
      () => 'must-not-rotate',
    )
    const changedSubmission = retainOpportunityCommentSubmissionIntent(
      firstSubmission,
      { ...submission, body: '项目已经完成。' },
      () => 'comment-submit-key-2',
    )
    expect(retriedSubmission).toBe(firstSubmission)
    expect(changedSubmission.idempotencyKey).toBe('comment-submit-key-2')

    const report = { commentId: 'comment-1', category: 'SPAM' }
    const firstReport = retainOpportunityCommentReportIntent(
      null,
      report,
      () => 'comment-report-key-1',
      () => 'comment-report-request-1',
    )
    const retriedReport = retainOpportunityCommentReportIntent(
      firstReport,
      report,
      () => 'must-not-rotate',
      () => 'must-not-rotate',
    )
    const changedReport = retainOpportunityCommentReportIntent(
      firstReport,
      { ...report, category: 'FRAUD' },
      () => 'comment-report-key-2',
      () => 'comment-report-request-2',
    )
    expect(retriedReport).toBe(firstReport)
    expect(changedReport).toMatchObject({
      idempotencyKey: 'comment-report-key-2',
      requestId: 'comment-report-request-2',
    })

    const page = readFileSync('src/packages/member/mip-opportunities/detail/index.ts', 'utf8')
    expect(page).toContain('intent.idempotencyKey')
    expect(page).toContain('requestId: intent.requestId')
    expect(page).toContain('this.commentSubmissionIntent = null')
    expect(page).toContain('this.commentReportIntent = null')
  })

  it('parses the admin moderation contract and rejects raw user ids', () => {
    const opaque = `p1.${'a'.repeat(16)}.${'b'.repeat(48)}.${'c'.repeat(22)}`
    const state = parseOpportunityCommentState({
      settings: { commentsEnabled: true, reviewsEnabled: true, callsEnabled: true, moderationMode: 'REVIEW', version: 2 },
      comments: [{
        id: '20000000-0000-4000-8000-000000000001',
        authorProfileRef: opaque,
        authorNickname: '参与人甲',
        type: 'REVIEW',
        body: '项目按计划完成。',
        rating: 5,
        participant: true,
        status: 'PENDING',
        callCount: 0,
        version: 1,
        createdAt: '2026-08-24T08:00:00.000Z',
        editedAt: null,
      }],
      reports: [],
    })
    expect(state.comments[0]?.participant).toBe(true)
    expect(() => parseOpportunityCommentState({
      ...state,
      comments: [{ ...state.comments[0], userId: 'raw-user' }],
    })).toThrow()
  })
})
