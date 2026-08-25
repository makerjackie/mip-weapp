'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const { createAdminAccess } = require('../domain/access')
const { createEventCommentAdminRepository } = require('../domain/event-comment-governance')
const { createAdminEventComments } = require('../domain/event-comments')

const APP_ID = 'wx-event-comments'
const ACTOR_ID = '10000000-0000-4000-8000-000000000001'
const EVENT_ID = '20000000-0000-4000-8000-000000000001'
const OTHER_EVENT_ID = '20000000-0000-4000-8000-000000000002'
const COMMENT_ID = '30000000-0000-4000-8000-000000000001'
const REPORT_ID = '40000000-0000-4000-8000-000000000001'
const BRANCH_ID = '50000000-0000-4000-8000-000000000001'

function adminRepository(database, assertedScopes = []) {
  return createEventCommentAdminRepository(database, {
    async lockMutationAuthorization(_tx, input) {
      assert.equal(input.authorization.capability, 'events.comments.manage')
      return {
        capability: 'events.comments.manage',
        effectiveGrant: input.authorization.effectiveGrant,
      }
    },
    assertMutationScope(_authorization, scope) {
      assertedScopes.push(scope)
    },
  })
}

function databaseWithTransaction(tx) {
  return {
    async one() { throw new Error('unexpected outside-transaction read') },
    async query() { throw new Error('unexpected outside-transaction read') },
    transaction: work => work(tx),
  }
}

function mutationInput(overrides = {}) {
  return {
    appId: APP_ID,
    actorUserId: ACTOR_ID,
    eventId: EVENT_ID,
    authorization: {
      capability: 'events.comments.manage',
      effectiveGrant: { roleKey: 'EVENT_MANAGER', scopeType: 'EVENT', scopeId: EVENT_ID },
    },
    audit: () => ({
      appId: APP_ID,
      actorUserId: ACTOR_ID,
      scopeType: 'EVENT',
      scopeId: EVENT_ID,
      action: 'admin.event_comments.test',
      resourceType: 'EVENT_COMMENT',
      resourceId: COMMENT_ID,
      effectiveRole: 'EVENT_MANAGER',
      metadata: {},
    }),
    ...overrides,
  }
}

describe('admin event comment repository', () => {
  it('loads only EVENT comments and reports after validating the target event', async () => {
    const reads = []
    const database = {
      transaction() { throw new Error('unexpected transaction') },
      async one(sql, params) {
        reads.push({ sql, params })
        if (sql.includes('FROM mip_events')) {
          return { id: EVENT_ID, title: '长期活动', status: 'PUBLISHED', version: 3 }
        }
        if (sql.includes('FROM mip_content_comment_settings')) {
          return { comments_enabled: 1, moderation_mode: 'REVIEW', version: 2 }
        }
        throw new Error(`unexpected query: ${sql}`)
      },
      async query(sql, params) {
        reads.push({ sql, params })
        if (sql.includes('FROM mip_content_comments comment') && !sql.includes('mip_content_comment_reports')) {
          return [{
            id: COMMENT_ID,
            body: '活动评论',
            status: 'PENDING',
            version: 1,
            author_nickname: '玩家甲',
            created_at: new Date('2030-01-01T00:00:00.000Z'),
            edited_at: null,
          }]
        }
        if (sql.includes('FROM mip_content_comment_reports report')) {
          return [{
            id: REPORT_ID,
            comment_id: COMMENT_ID,
            reporter_nickname: '玩家乙',
            comment_author_nickname: '玩家甲',
            comment_body: '活动评论',
            comment_status: 'PENDING',
            category: 'SPAM',
            description: '',
            status: 'PENDING',
            version: 1,
            reviewed_by_user_id: null,
            created_at: new Date('2030-01-02T00:00:00.000Z'),
            reviewed_at: null,
          }]
        }
        throw new Error(`unexpected query: ${sql}`)
      },
    }

    const state = await adminRepository(database).getEventCommentAdminState(APP_ID, EVENT_ID)
    assert.equal(state.event.id, EVENT_ID)
    assert.equal(state.settings.moderationMode, 'REVIEW')
    assert.equal(state.comments[0].authorNickname, '玩家甲')
    assert.equal(state.reports[0].reviewedByUserId, null)
    assert.equal(state.reports[0].commentBody, '活动评论')
    for (const read of reads.filter(item => /mip_content_comment/.test(item.sql))) {
      assert.match(read.sql, /target_type = 'EVENT'/)
    }

    database.one = async (sql) => {
      if (sql.includes('FROM mip_events')) {
        return null
      }
      throw new Error('unexpected')
    }
    await assert.rejects(
      adminRepository(database).getEventCommentAdminState(APP_ID, OTHER_EVENT_ID),
      error => error?.code === 'NOT_FOUND',
    )
  })

  it('locks authorization, event and settings in one transaction before a versioned audit write', async () => {
    const writes = []
    const assertedScopes = []
    const tx = {
      async one(sql) {
        if (sql.includes('FROM mip_events')) {
          return { id: EVENT_ID, branch_id: BRANCH_ID }
        }
        if (sql.includes('FROM mip_content_comment_settings')) {
          return { version: 2 }
        }
        throw new Error(`unexpected query: ${sql}`)
      },
      async query(sql, params) {
        writes.push({ sql, params })
        return { affectedRows: 1 }
      },
    }
    const result = await adminRepository(
      databaseWithTransaction(tx),
      assertedScopes,
    ).saveEventCommentSettings(mutationInput({
      expectedVersion: 2,
      settings: { commentsEnabled: false, moderationMode: 'REVIEW' },
    }))

    assert.deepEqual(result, { commentsEnabled: false, moderationMode: 'REVIEW', version: 3 })
    assert.deepEqual(assertedScopes, [{ scopeType: 'EVENT', scopeId: EVENT_ID, branchId: BRANCH_ID }])
    const update = writes.find(item => item.sql.includes('UPDATE mip_content_comment_settings'))
    assert.match(update.sql, /target_type = 'EVENT'/)
    assert.deepEqual(update.params.slice(-4), [ACTOR_ID, APP_ID, EVENT_ID, 2])
    assert.equal(writes.filter(item => item.sql.includes('INSERT INTO mip_audit_logs')).length, 1)
  })

  it('fails a concurrent settings insert closed without writing an audit', async () => {
    const writes = []
    const tx = {
      async one(sql) {
        if (sql.includes('FROM mip_events')) {
          return { id: EVENT_ID, branch_id: BRANCH_ID }
        }
        if (sql.includes('FROM mip_content_comment_settings')) {
          return null
        }
        throw new Error(`unexpected query: ${sql}`)
      },
      async query(sql) {
        writes.push(sql)
        if (sql.includes('INSERT INTO mip_content_comment_settings')) {
          const error = new Error('duplicate')
          error.code = 'ER_DUP_ENTRY'
          throw error
        }
        return { affectedRows: 1 }
      },
    }
    await assert.rejects(adminRepository(databaseWithTransaction(tx)).saveEventCommentSettings(
      mutationInput({
        expectedVersion: 0,
        settings: { commentsEnabled: true, moderationMode: 'AUTO' },
      }),
    ), error => error?.code === 'CONFLICT')
    assert.equal(writes.some(sql => sql.includes('INSERT INTO mip_audit_logs')), false)
  })

  it('fails closed for cross-event comments and stale duplicate moderation', async () => {
    const writes = []
    let comment = null
    const tx = {
      async one(sql) {
        if (sql.includes('FROM mip_events')) {
          return { id: EVENT_ID, branch_id: BRANCH_ID }
        }
        if (sql.includes('FROM mip_content_comments')) {
          return comment
        }
        throw new Error(`unexpected query: ${sql}`)
      },
      async query(sql, params) {
        writes.push({ sql, params })
        return { affectedRows: 1 }
      },
    }
    const repository = adminRepository(databaseWithTransaction(tx))
    const input = mutationInput({
      commentId: COMMENT_ID,
      expectedVersion: 2,
      action: 'PUBLISH',
      reason: '审核通过',
    })
    await assert.rejects(repository.moderateEventComment(input), error => error?.code === 'NOT_FOUND')
    assert.equal(writes.length, 0)

    comment = { id: COMMENT_ID, status: 'PUBLISHED', version: 3 }
    await assert.rejects(repository.moderateEventComment(input), error => error?.code === 'CONFLICT')
    assert.equal(writes.length, 0)

    comment = { id: COMMENT_ID, status: 'PENDING', version: 2 }
    const published = await repository.moderateEventComment(input)
    assert.deepEqual(published, { id: COMMENT_ID, status: 'PUBLISHED', version: 3 })
    assert.match(writes.find(item => item.sql.includes('UPDATE mip_content_comments')).sql, /target_type = 'EVENT'/)
    assert.equal(writes.filter(item => item.sql.includes('INSERT INTO mip_audit_logs')).length, 1)
    const outbox = writes.find(item => item.sql.includes('INSERT INTO mip_outbox_events'))
    assert.match(outbox.sql, /'EVENT_COMMENT'/)
    assert.match(outbox.sql, /'event\.comment_published'/)
    assert.match(outbox.params[0], /^[0-9a-f-]{36}$/i)
    assert.deepEqual(outbox.params.slice(1), [APP_ID, COMMENT_ID, 3])

    writes.length = 0
    comment = { id: COMMENT_ID, status: 'PUBLISHED', version: 3 }
    const hidden = await repository.moderateEventComment({
      ...input,
      action: 'HIDE',
      expectedVersion: 3,
    })
    assert.deepEqual(hidden, { id: COMMENT_ID, status: 'HIDDEN', version: 4 })
    assert.equal(writes.some(item => item.sql.includes('INSERT INTO mip_outbox_events')), false)
  })

  it('requires an exact claim before the same operator can close a report', async () => {
    const writes = []
    let report = {
      comment_id: COMMENT_ID,
      status: 'PENDING',
      version: 1,
      reviewed_by_user_id: null,
    }
    const tx = {
      async one(sql) {
        if (sql.includes('FROM mip_events')) {
          return { id: EVENT_ID, branch_id: BRANCH_ID }
        }
        if (sql.includes('FROM mip_content_comment_reports report')) {
          return report
        }
        throw new Error(`unexpected query: ${sql}`)
      },
      async query(sql, params) {
        writes.push({ sql, params })
        return { affectedRows: 1 }
      },
    }
    const repository = adminRepository(databaseWithTransaction(tx))
    const claimed = await repository.claimEventCommentReport(mutationInput({
      reportId: REPORT_ID,
      expectedVersion: 1,
    }))
    assert.deepEqual(claimed, { id: REPORT_ID, status: 'REVIEWING', version: 2 })
    assert.match(writes.find(item => item.sql.includes('SET status = \'REVIEWING\'')).sql, /target_type = 'EVENT'/)

    report = { ...report, status: 'REVIEWING', version: 2, reviewed_by_user_id: 'another-user' }
    await assert.rejects(repository.closeEventCommentReport(mutationInput({
      reportId: REPORT_ID,
      expectedVersion: 2,
      decision: 'RESOLVED',
      reason: '确认违规',
    })), error => error?.code === 'CONFLICT')

    report = { ...report, reviewed_by_user_id: ACTOR_ID }
    const closed = await repository.closeEventCommentReport(mutationInput({
      reportId: REPORT_ID,
      expectedVersion: 2,
      decision: 'DISMISSED',
      reason: '证据不足',
    }))
    assert.deepEqual(closed, { id: REPORT_ID, status: 'DISMISSED', version: 3 })
    assert.match(writes.find(item => item.sql.includes('SET status = ?')).sql, /target_type = 'EVENT'/)
    assert.equal(writes.filter(item => item.sql.includes('INSERT INTO mip_audit_logs')).length, 2)
  })
})

describe('admin event comment service', () => {
  function serviceRepository(overrides = {}) {
    return {
      async resolveUser() {
        return {
          id: ACTOR_ID,
          status: 'ACTIVE',
          agreementsAccepted: true,
          phoneBound: true,
          profileComplete: true,
        }
      },
      async listRoleBindings() {
        return [{ roleKey: 'EVENT_MANAGER', scopeType: 'EVENT', scopeId: EVENT_ID }]
      },
      async getEventScope(_appId, eventId) {
        return eventId === EVENT_ID
          ? { scopeType: 'EVENT', scopeId: EVENT_ID, branchId: BRANCH_ID }
          : null
      },
      async getEventCommentAdminState() {
        return {
          event: { id: EVENT_ID, title: '长期活动', status: 'PUBLISHED', version: 2 },
          settings: { commentsEnabled: true, moderationMode: 'AUTO', version: 0 },
          comments: [],
          reports: [{
            id: REPORT_ID,
            commentId: COMMENT_ID,
            commentAuthorNickname: '玩家甲',
            commentBody: '活动评论',
            commentStatus: 'PENDING',
            reporterNickname: '玩家乙',
            category: 'SPAM',
            description: '',
            status: 'REVIEWING',
            version: 2,
            reviewedByUserId: ACTOR_ID,
            createdAt: null,
            reviewedAt: null,
          }],
        }
      },
      ...overrides,
    }
  }

  it('authorizes EVENT_MANAGER through events.comments.manage and hides internal reviewer ids', async () => {
    const repository = serviceRepository()
    const service = createAdminEventComments({
      access: createAdminAccess({ repository }),
      repository,
    })
    const state = await service.getEventCommentAdminState(
      { appId: APP_ID, identityKey: 'identity' },
      { eventId: EVENT_ID },
    )
    assert.equal(state.reports[0].claimedByMe, true)
    assert.equal(Object.hasOwn(state.reports[0], 'reviewedByUserId'), false)
  })

  it('rejects extra settings fields and passes only server authorization and audit facts', async () => {
    let captured
    const repository = serviceRepository({
      async saveEventCommentSettings(input) {
        captured = input
        return { ...input.settings, version: 1 }
      },
    })
    const service = createAdminEventComments({
      access: createAdminAccess({ repository }),
      repository,
    })
    const caller = { appId: APP_ID, identityKey: 'identity' }

    await assert.rejects(service.saveEventCommentSettings(caller, {
      eventId: EVENT_ID,
      expectedVersion: 0,
      settings: { commentsEnabled: true, moderationMode: 'AUTO', scopeType: 'PLATFORM' },
    }), error => error?.code === 'VALIDATION_FAILED')

    await assert.rejects(service.saveEventCommentSettings(caller, {
      eventId: EVENT_ID,
      expectedVersion: 0,
      settings: { commentsEnabled: true, moderationMode: 'AUTO' },
      scopeType: 'PLATFORM',
    }), error => error?.code === 'VALIDATION_FAILED')

    await service.saveEventCommentSettings(caller, {
      eventId: EVENT_ID,
      expectedVersion: 0,
      settings: { commentsEnabled: false, moderationMode: 'REVIEW' },
    })
    assert.equal(captured.authorization.capability, 'events.comments.manage')
    assert.deepEqual(captured.authorization.effectiveGrant, {
      roleKey: 'EVENT_MANAGER',
      scopeType: 'EVENT',
      scopeId: EVENT_ID,
    })
    assert.equal(captured.audit(1).scopeType, 'EVENT')
    assert.equal(captured.audit(1).resourceId, EVENT_ID)
  })
})
