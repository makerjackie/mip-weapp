'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const { createOpportunityCommentAdminRepository } = require('../domain/opportunity-comments')

const appId = 'wx-admin-comments'
const actorUserId = '10000000-0000-4000-8000-000000000001'
const opportunityId = '20000000-0000-4000-8000-000000000001'
const otherOpportunityId = '20000000-0000-4000-8000-000000000002'
const commentId = '30000000-0000-4000-8000-000000000001'
const reportId = '40000000-0000-4000-8000-000000000001'

function repositoryWith(tx, assertedScopes) {
  return createOpportunityCommentAdminRepository({
    transaction: work => work(tx),
  }, {
    async lockMutationAuthorization() {
      return { effectiveGrant: { scopeType: 'BRANCH', scopeId: 'branch-1' } }
    },
    assertMutationScope(_authorization, scope) {
      assertedScopes.push(scope)
    },
  })
}

describe('admin opportunity comments', () => {
  it('creates settings at version zero and records scoped audit', async () => {
    const writes = []
    const assertedScopes = []
    const tx = {
      async one(sql) {
        if (sql.includes('FROM mip_opportunities')) return { id: opportunityId, branch_id: 'branch-1' }
        if (sql.includes('FROM mip_opportunity_comment_settings')) return null
        throw new Error(`unexpected query: ${sql}`)
      },
      async query(sql, params) {
        writes.push({ sql, params })
        return { affectedRows: 1 }
      },
    }
    const repository = repositoryWith(tx, assertedScopes)
    const result = await repository.saveOpportunityCommentSettings({
      appId,
      actorUserId,
      opportunityId,
      expectedVersion: 0,
      settings: { commentsEnabled: true, reviewsEnabled: true, callsEnabled: false, moderationMode: 'REVIEW' },
      audit: version => ({
        appId, actorUserId, scopeType: 'BRANCH', scopeId: 'branch-1',
        action: 'admin.opportunity_comments.settings.update', resourceType: 'OPPORTUNITY_COMMENT_SETTINGS',
        resourceId: opportunityId, metadata: { version }, effectiveRole: 'BRANCH_ADMIN',
      }),
    })
    assert.equal(result.version, 1)
    assert.deepEqual(assertedScopes, [{ scopeType: 'BRANCH', scopeId: 'branch-1' }])
    assert.equal(writes.filter(call => call.sql.includes('INSERT INTO mip_opportunity_comment_settings')).length, 1)
    assert.equal(writes.filter(call => call.sql.includes('INSERT INTO mip_audit_logs')).length, 1)
  })

  it('moderates with optimistic version and the actual opportunity scope', async () => {
    const writes = []
    const assertedScopes = []
    const tx = {
      async one(sql) {
        if (sql.includes('FROM mip_opportunity_comments comment')) {
          return { opportunity_id: opportunityId, branch_id: 'branch-1', status: 'PENDING', version: 2 }
        }
        throw new Error(`unexpected query: ${sql}`)
      },
      async query(sql, params) {
        writes.push({ sql, params })
        return { affectedRows: 1 }
      },
    }
    const repository = repositoryWith(tx, assertedScopes)
    const result = await repository.moderateOpportunityComment({
      appId,
      actorUserId,
      commentId,
      expectedVersion: 2,
      action: 'PUBLISH',
      reason: '内容审核通过',
      audit: (resourceOpportunityId, status) => ({
        appId, actorUserId, scopeType: 'BRANCH', scopeId: 'branch-1',
        action: 'admin.opportunity_comments.publish', resourceType: 'OPPORTUNITY_COMMENT',
        resourceId: commentId, metadata: { resourceOpportunityId, status }, effectiveRole: 'BRANCH_ADMIN',
      }),
    })
    assert.deepEqual(result, { id: commentId, status: 'PUBLISHED', version: 3 })
    assert.deepEqual(assertedScopes, [{ scopeType: 'BRANCH', scopeId: 'branch-1' }])
    const update = writes.find(call => call.sql.includes('UPDATE mip_opportunity_comments'))
    assert.deepEqual(update.params.slice(-3), [appId, commentId, 2])
  })

  it('refuses to close a report that belongs to another opportunity in the same branch', async () => {
    const writes = []
    const assertedScopes = []
    const tx = {
      async one(sql) {
        if (sql.includes('FROM mip_opportunity_comment_reports report')) {
          return {
            comment_id: commentId,
            opportunity_id: otherOpportunityId,
            branch_id: 'branch-1',
            status: 'PENDING',
            version: 1,
          }
        }
        throw new Error(`unexpected query: ${sql}`)
      },
      async query(sql, params) {
        writes.push({ sql, params })
        return { affectedRows: 1 }
      },
    }
    const repository = repositoryWith(tx, assertedScopes)
    await assert.rejects(
      repository.closeOpportunityCommentReport({
        appId,
        actorUserId,
        opportunityId,
        reportId,
        expectedVersion: 1,
        decision: 'RESOLVED',
        reason: '确认违规',
        audit: () => { throw new Error('audit must not run') },
      }),
      error => error?.code === 'CONFLICT',
    )
    assert.deepEqual(assertedScopes, [])
    assert.equal(writes.length, 0)
  })
})
