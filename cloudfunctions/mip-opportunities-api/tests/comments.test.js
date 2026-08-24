'use strict'

const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const { describe, it } = require('node:test')
const {
  listOpportunityComments,
  normalizeComment,
  reportOpportunityComment,
  saveOpportunityComment,
  setOpportunityCommentCall,
} = require('../domain/comments')

const appId = 'wx-opportunity-comments'
const userId = '10000000-0000-4000-8000-000000000001'
const authorUserId = '20000000-0000-4000-8000-000000000001'
const opportunityId = '30000000-0000-4000-8000-000000000001'
const commentId = '40000000-0000-4000-8000-000000000001'
const pepper = 'opportunity-comment-profile-reference-secret-long-enough'
const caller = { appId, userId, profileRefSecret: pepper }

describe('opportunity comments', () => {
  it('validates comment and review shapes independently', () => {
    assert.deepEqual(normalizeComment({ type: 'COMMENT', body: '  进度清晰  ', rating: 5 }), {
      commentId: null,
      expectedVersion: null,
      type: 'COMMENT',
      body: '进度清晰',
      rating: null,
    })
    assert.equal(normalizeComment({ type: 'REVIEW', body: '交付完整', rating: 5 }).rating, 5)
    assert.throws(() => normalizeComment({ type: 'REVIEW', body: '交付完整', rating: 0 }), /VALIDATION_FAILED/)
  })

  it('lists only visible comments and returns opaque author references', async () => {
    const calls = []
    const database = {
      async one(sql) {
        if (sql.includes('FROM mip_opportunities o')) {
          assert.match(sql, /member\.status = 'ACTIVE'/)
          return { id: opportunityId, status: 'ENDED', caller_can_call: 1 }
        }
        if (sql.includes('FROM mip_opportunity_comment_settings')) return null
        throw new Error(`unexpected one: ${sql}`)
      },
      async query(sql, params) {
        calls.push({ sql, params })
        return [{
          id: commentId,
          author_user_id: authorUserId,
          comment_type: 'REVIEW',
          body: '合作过程清楚。',
          rating: 5,
          author_is_participant: 1,
          status: 'PUBLISHED',
          call_count: 3,
          version: 1,
          created_at: '2026-08-24T08:00:00.000Z',
          edited_at: null,
          nickname: '参与人甲',
          headline: '项目负责人',
          visibility_json: '{}',
          avatar_file_id: null,
          call_active: 1,
          within_edit_window: 0,
        }]
      },
    }
    const result = await listOpportunityComments(database, caller, { opportunityId })
    assert.equal(result.items[0].author.participant, true)
    assert.equal(result.settings.canCall, true)
    assert.match(result.items[0].author.profileRef, /^p1\./)
    assert.equal(JSON.stringify(result).includes(authorUserId), false)
    assert.match(calls[0].sql, /mip_user_blocks/)
    assert.match(calls[0].sql, /comment\.status = 'PUBLISHED'/)
  })

  it('derives participant status from opportunity facts and queues review-mode comments', async () => {
    const writes = []
    const tx = {
      async one(sql) {
        if (sql.includes('FROM mip_idempotency_keys')) return null
        if (sql.includes('FROM mip_users')) return { id: userId, status: 'ACTIVE' }
        if (sql.includes('FROM mip_opportunities o')) {
          assert.match(sql, /mip_opportunity_team_members/)
          return {
            id: opportunityId,
            owner_user_id: authorUserId,
            status: 'ENDED',
            comments_enabled: 1,
            reviews_enabled: 1,
            calls_enabled: 1,
            moderation_mode: 'REVIEW',
            caller_is_participant: 1,
          }
        }
        throw new Error(`unexpected one: ${sql}`)
      },
      async query(sql, params) {
        writes.push({ sql, params })
        return { affectedRows: 1 }
      },
    }
    const result = await saveOpportunityComment({ transaction: work => work(tx) }, {
      async assertSafe(_caller, values) { assert.deepEqual(values, ['项目按计划交付。']) },
    }, caller, {
      opportunityId,
      type: 'REVIEW',
      rating: 4,
      body: '项目按计划交付。',
      idempotencyKey: 'opportunity-comment-create-0001',
    })
    assert.equal(result.status, 'PENDING')
    assert.equal(result.participant, true)
    const insert = writes.find(call => call.sql.includes('INSERT INTO mip_opportunity_comments'))
    assert.equal(insert.params[7], 1)
    assert.equal(insert.params[8], 'PENDING')
  })

  it('replays completed comment creation and report requests without another business write', async () => {
    const cases = [
      {
        operation: saveOpportunityComment,
        request: {
          opportunityId,
          commentId: null,
          expectedVersion: null,
          type: 'COMMENT',
          body: '项目按计划交付。',
          rating: null,
        },
        input: {
          opportunityId,
          type: 'COMMENT',
          body: '项目按计划交付。',
          idempotencyKey: 'opportunity-comment-create-replay-0001',
        },
        response: { id: commentId, status: 'PUBLISHED', version: 1, participant: true },
      },
      {
        operation: reportOpportunityComment,
        request: {
          commentId,
          category: 'SPAM',
          description: null,
          requestId: 'opportunity-comment-report-request-0001',
        },
        input: {
          commentId,
          category: 'SPAM',
          description: '',
          requestId: 'opportunity-comment-report-request-0001',
          idempotencyKey: 'opportunity-comment-report-replay-0001',
        },
        response: { reportId: '50000000-0000-4000-8000-000000000001', status: 'PENDING' },
      },
    ]
    for (const entry of cases) {
      const writes = []
      const hash = createHash('sha256').update(JSON.stringify(entry.request)).digest('hex')
      const database = {
        transaction: work => work({
          async one(sql) {
            assert.match(sql, /FROM mip_idempotency_keys/)
            return {
              request_hash: hash,
              status: 'COMPLETED',
              response_json: JSON.stringify(entry.response),
            }
          },
          async query(sql, params) {
            writes.push({ sql, params })
            return { affectedRows: 1 }
          },
        }),
      }
      const result = entry.operation === saveOpportunityComment
        ? await entry.operation(database, { assertSafe: async () => undefined }, caller, entry.input)
        : await entry.operation(database, caller, entry.input)
      assert.deepEqual(result, entry.response)
      assert.equal(writes.length, 0)
    }
  })

  it('updates call facts and the server-maintained count once', async () => {
    const writes = []
    const tx = {
      async one(sql) {
        if (sql.includes('FROM mip_idempotency_keys')) return null
        if (sql.includes('FROM mip_users')) return { id: userId, status: 'ACTIVE' }
        if (sql.includes('LEFT JOIN mip_opportunity_comment_settings')) {
          assert.match(sql, /mip_opportunity_team_members/)
          assert.match(sql, /member\.status = 'ACTIVE'/)
          return {
            author_user_id: authorUserId,
            status: 'PUBLISHED',
            call_count: 2,
            calls_enabled: 1,
            caller_can_call: 1,
          }
        }
        if (sql.includes('SELECT 1 AS visible')) return { visible: 1 }
        if (sql.includes('FROM mip_opportunity_comment_calls')) return null
        throw new Error(`unexpected one: ${sql}`)
      },
      async query(sql, params) {
        writes.push({ sql, params })
        return { affectedRows: 1 }
      },
    }
    const result = await setOpportunityCommentCall({ transaction: work => work(tx) }, caller, {
      commentId,
      active: true,
      idempotencyKey: 'opportunity-comment-call-0001',
    })
    assert.deepEqual(result, { id: commentId, active: true, callCount: 3 })
    assert.equal(writes.filter(call => call.sql.includes('INSERT INTO mip_opportunity_comment_calls')).length, 1)
    assert.equal(writes.filter(call => /SET call_count = call_count \+ 1/.test(call.sql)).length, 1)
  })

  it('rejects calls from users who are not current opportunity participants', async () => {
    const writes = []
    const tx = {
      async one(sql) {
        if (sql.includes('FROM mip_idempotency_keys')) return null
        if (sql.includes('FROM mip_users')) return { id: userId, status: 'ACTIVE' }
        if (sql.includes('LEFT JOIN mip_opportunity_comment_settings')) {
          assert.match(sql, /member\.status = 'ACTIVE'/)
          return {
            author_user_id: authorUserId,
            status: 'PUBLISHED',
            call_count: 2,
            calls_enabled: 1,
            caller_can_call: 0,
          }
        }
        throw new Error(`unexpected one: ${sql}`)
      },
      async query(sql, params) {
        writes.push({ sql, params })
        return { affectedRows: 1 }
      },
    }

    await assert.rejects(
      setOpportunityCommentCall({ transaction: work => work(tx) }, caller, {
        commentId,
        active: true,
        idempotencyKey: 'opportunity-comment-call-ineligible-0001',
      }),
      /CALL_PARTICIPANT_REQUIRED/,
    )
    assert.equal(writes.some(call => call.sql.includes('mip_opportunity_comment_calls')), false)
    assert.equal(writes.some(call => call.sql.includes('SET call_count')), false)
  })
})
