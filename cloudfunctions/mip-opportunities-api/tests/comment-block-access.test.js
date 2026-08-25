'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const {
  listOpportunityComments,
  reportOpportunityComment,
  saveOpportunityComment,
  setOpportunityCommentCall,
} = require('../domain/comments')

const appId = 'wx-opportunity-comment-blocks'
const callerUserId = '10000000-0000-4000-8000-000000000001'
const opportunityId = '20000000-0000-4000-8000-000000000001'
const commentId = '30000000-0000-4000-8000-000000000001'
const caller = {
  appId,
  userId: callerUserId,
  profileRefSecret: 'opportunity-comment-block-profile-secret-more-than-32-characters',
}

function assertMutualBlock(sql, subjectSql, appSql) {
  assert.match(sql, /FROM mip_user_blocks visibility_block/)
  assert.match(sql, new RegExp(`visibility_block\\.app_id = ${appSql.replace('.', '\\.')}`))
  assert.match(sql, new RegExp(`blocker_user_id = \\? AND visibility_block\\.blocked_user_id = ${subjectSql.replace('.', '\\.')}`))
  assert.match(sql, new RegExp(`blocker_user_id = ${subjectSql.replace('.', '\\.')} AND visibility_block\\.blocked_user_id = \\?`))
}

function blockedMutationDatabase(assertResourceQuery) {
  const writes = []
  return {
    writes,
    database: {
      transaction: work => work({
        async one(sql, params) {
          if (sql.includes('FROM mip_idempotency_keys')) return null
          if (sql.includes('FROM mip_users')) return { id: callerUserId, status: 'ACTIVE' }
          assertResourceQuery(sql, params)
          return null
        },
        async query(sql, params) {
          writes.push({ sql, params })
          return { affectedRows: 1 }
        },
      }),
    },
  }
}

describe('opportunity comment block access', () => {
  it('fails closed before listing when the current opportunity owner relationship is blocked', async () => {
    const calls = []
    const database = {
      async one(sql, params) {
        calls.push({ sql, params })
        return null
      },
      async query() {
        throw new Error('comment rows must not be queried for a blocked opportunity')
      },
    }

    await assert.rejects(
      listOpportunityComments(database, caller, { opportunityId }),
      /NOT_FOUND/,
    )

    assert.equal(calls.length, 1)
    assertMutualBlock(calls[0].sql, 'o.owner_user_id', 'o.app_id')
    assert.deepEqual(calls[0].params.slice(-2), [callerUserId, callerUserId])
  })

  it('rechecks both the owner and each author in the comment-list statement', async () => {
    const queries = []
    const database = {
      async one(sql) {
        if (sql.includes('FROM mip_opportunities o')) {
          return { id: opportunityId, status: 'PUBLISHED', caller_can_call: 0 }
        }
        if (sql.includes('FROM mip_opportunity_comment_settings')) return null
        throw new Error(`unexpected one: ${sql}`)
      },
      async query(sql, params) {
        queries.push({ sql, params })
        return []
      },
    }

    const result = await listOpportunityComments(database, caller, { opportunityId })

    assert.deepEqual(result.items, [])
    assert.equal(queries.length, 1)
    assert.match(queries[0].sql, /INNER JOIN mip_opportunities opportunity/)
    assertMutualBlock(queries[0].sql, 'comment.author_user_id', 'comment.app_id')
    assertMutualBlock(queries[0].sql, 'opportunity.owner_user_id', 'opportunity.app_id')
    assert.deepEqual(queries[0].params.slice(-4), [
      callerUserId,
      callerUserId,
      callerUserId,
      callerUserId,
    ])
  })

  it('rechecks the current opportunity owner before creating or editing a comment', async () => {
    const inputs = [
      {
        opportunityId,
        type: 'COMMENT',
        body: '当前进度清楚。',
        idempotencyKey: 'blocked-opportunity-comment-create-0001',
      },
      {
        opportunityId,
        commentId,
        expectedVersion: 1,
        type: 'COMMENT',
        body: '当前进度已更新。',
        idempotencyKey: 'blocked-opportunity-comment-edit-0001',
      },
    ]

    for (const input of inputs) {
      const { database, writes } = blockedMutationDatabase((sql, params) => {
        assert.match(sql, /FROM mip_opportunities o/)
        assertMutualBlock(sql, 'o.owner_user_id', 'o.app_id')
        assert.deepEqual(params.slice(-2), [callerUserId, callerUserId])
        assert.match(sql, /FOR UPDATE/)
      })

      await assert.rejects(
        saveOpportunityComment(
          database,
          { assertSafe: async () => undefined },
          caller,
          input,
        ),
        /NOT_FOUND/,
      )

      assert.equal(writes.some(call => call.sql.includes('mip_opportunity_comments')), false)
    }
  })

  it('rechecks the current opportunity owner for direct call and report mutations', async () => {
    const cases = [
      {
        invoke(database) {
          return setOpportunityCommentCall(database, caller, {
            commentId,
            active: true,
            idempotencyKey: 'blocked-opportunity-comment-call-0001',
          })
        },
        assertQuery(sql, params) {
          assert.match(sql, /INNER JOIN mip_opportunities opportunity/)
          assertMutualBlock(sql, 'opportunity.owner_user_id', 'opportunity.app_id')
          assert.deepEqual(params.slice(-2), [callerUserId, callerUserId])
        },
      },
      {
        invoke(database) {
          return reportOpportunityComment(database, caller, {
            commentId,
            category: 'SPAM',
            description: '',
            requestId: 'blocked-opportunity-comment-report-request-0001',
            idempotencyKey: 'blocked-opportunity-comment-report-0001',
          })
        },
        assertQuery(sql, params) {
          assert.match(sql, /INNER JOIN mip_opportunities opportunity/)
          assertMutualBlock(sql, 'comment.author_user_id', 'comment.app_id')
          assertMutualBlock(sql, 'opportunity.owner_user_id', 'opportunity.app_id')
          assert.deepEqual(params.slice(-4), [
            callerUserId,
            callerUserId,
            callerUserId,
            callerUserId,
          ])
        },
      },
    ]

    for (const entry of cases) {
      const { database, writes } = blockedMutationDatabase((sql, params) => {
        entry.assertQuery(sql, params)
        assert.match(sql, /FOR UPDATE/)
      })
      await assert.rejects(entry.invoke(database), /NOT_FOUND/)
      assert.equal(writes.some(call => call.sql.includes('mip_opportunity_comment_calls')), false)
      assert.equal(writes.some(call => call.sql.includes('mip_opportunity_comment_reports')), false)
    }
  })
})
