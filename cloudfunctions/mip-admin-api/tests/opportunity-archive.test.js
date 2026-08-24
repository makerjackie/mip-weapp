'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { describe, it } = require('node:test')
const { actions, errorResponse } = require('../domain/handler')
const {
  createOpportunityArchiveRepository: createProductionOpportunityArchiveRepository,
  createOpportunityArchiveService,
  normalizeArchiveRequest,
} = require('../domain/opportunity-archive')
const { withTestAuthorization } = require('./test-authorization')

const APP_ID = 'wx-app'
const ADMIN_ID = '00000000-0000-4000-8000-000000000001'
const OPPORTUNITY_ID = '00000000-0000-4000-8000-000000000002'
const BRANCH_ID = '00000000-0000-4000-8000-000000000003'
const ARCHIVED_AT = new Date('2026-08-24T12:00:00.000Z')

function createOpportunityArchiveRepository(database, options) {
  return createProductionOpportunityArchiveRepository(database, withTestAuthorization(options))
}

function opportunity(overrides = {}) {
  return {
    id: OPPORTUNITY_ID,
    scope_type: 'BRANCH',
    branch_id: BRANCH_ID,
    status: 'DRAFT',
    version: 4,
    referral_count: 0,
    ...overrides,
  }
}

function transactionDatabase({ one, query } = {}) {
  const tx = {
    one: one || (async () => null),
    query: query || (async () => ({ affectedRows: 1 })),
  }
  return {
    one: tx.one,
    query: tx.query,
    async transaction(work) {
      return work(tx)
    },
  }
}

function archiveInput(overrides = {}) {
  return {
    appId: APP_ID,
    actorUserId: ADMIN_ID,
    opportunityId: OPPORTUNITY_ID,
    expectedVersion: 4,
    reason: '清理未使用草稿',
    authorizedScope: { scopeType: 'BRANCH', scopeId: BRANCH_ID },
    effectiveRole: 'PLATFORM_OPERATIONS',
    ...overrides,
  }
}

describe('opportunity archive repository', () => {
  it('archives an empty draft with an app-scoped optimistic lock and audit', async () => {
    const calls = []
    const repository = createOpportunityArchiveRepository(transactionDatabase({
      async one(sql, params) {
        calls.push({ kind: 'one', sql, params })
        if (sql.includes('FROM mip_opportunities')) return opportunity()
        return null
      },
      async query(sql, params) {
        calls.push({ kind: 'query', sql, params })
        return { affectedRows: 1 }
      },
    }), { now: () => ARCHIVED_AT })

    const result = await repository.archiveOpportunity(archiveInput())

    assert.deepEqual(result, {
      id: OPPORTUNITY_ID,
      status: 'ARCHIVED',
      version: 5,
      archivedAt: '2026-08-24T12:00:00.000Z',
    })
    const lock = calls[0]
    assert.match(lock.sql, /FROM mip_opportunities[\s\S]*app_id = \? AND id = \? FOR UPDATE/)
    assert.deepEqual(lock.params, [APP_ID, OPPORTUNITY_ID])

    const updateIndex = calls.findIndex(call => call.sql.includes('UPDATE mip_opportunities'))
    const auditIndex = calls.findIndex(call => call.sql.includes('INSERT INTO mip_audit_logs'))
    assert.ok(updateIndex > 0 && auditIndex > updateIndex)
    assert.match(calls[updateIndex].sql, /status = 'ARCHIVED'/)
    assert.match(calls[updateIndex].sql, /version = version \+ 1/)
    assert.match(calls[updateIndex].sql, /status IN \('DRAFT', 'UNPUBLISHED', 'ENDED'\)/)
    assert.deepEqual(calls[updateIndex].params, [
      ARCHIVED_AT,
      ADMIN_ID,
      '清理未使用草稿',
      APP_ID,
      OPPORTUNITY_ID,
      4,
    ])
    assert.match(calls[auditIndex].sql, /admin\.opportunities\.archive/)
    assert.deepEqual(calls[auditIndex].params.slice(0, 6), [
      APP_ID,
      ADMIN_ID,
      'BRANCH',
      BRANCH_ID,
      OPPORTUNITY_ID,
      'PLATFORM_OPERATIONS',
    ])
    assert.equal(calls.some(call => /\bDELETE\s+FROM\b/i.test(call.sql)), false)
  })

  it('archives while preserving every durable business fact', async () => {
    const markers = {
      REFERRAL_INTENTS: 'mip_referral_intents',
      PROFILE_INTERESTS: 'mip_profile_interests',
      ORDERS: 'mip_orders',
      ANNOUNCEMENTS: 'mip_announcements',
      OUTBOX_EVENTS: 'mip_outbox_events',
    }
    for (const marker of Object.values(markers)) {
      const writes = []
      const repository = createOpportunityArchiveRepository(transactionDatabase({
        async one(sql) {
          if (sql.includes('FROM mip_opportunities')) return opportunity()
          return sql.includes(marker) ? { id: 'durable-fact' } : null
        },
        async query(sql) {
          writes.push(sql)
          return { affectedRows: 1 }
        },
      }))
      const result = await repository.archiveOpportunity(archiveInput())
      assert.equal(result.status, 'ARCHIVED')
      assert.equal(writes.some(sql => /DELETE\s+FROM/i.test(sql)), false)
    }
  })

  it('keeps referral history when the denormalized count is non-zero', async () => {
    const writes = []
    const repository = createOpportunityArchiveRepository(transactionDatabase({
      async one(sql) {
        if (sql.includes('FROM mip_opportunities')) return opportunity({ referral_count: 2 })
        return null
      },
      async query(sql) {
        writes.push(sql)
        return { affectedRows: 1 }
      },
    }))
    const result = await repository.archiveOpportunity(archiveInput())
    assert.equal(result.status, 'ARCHIVED')
    assert.equal(writes.some(sql => /DELETE\s+FROM/i.test(sql)), false)
  })

  it('rejects stale, non-draft and re-scoped records before mutation', async () => {
    const scenarios = [
      { row: opportunity({ version: 5 }), input: archiveInput(), code: 'CONFLICT' },
      { row: opportunity({ status: 'PUBLISHED' }), input: archiveInput(), code: 'INVALID_STATE' },
      {
        row: opportunity(),
        input: archiveInput({ authorizedScope: { scopeType: 'BRANCH', scopeId: ADMIN_ID } }),
        code: 'CONFLICT',
      },
    ]
    for (const scenario of scenarios) {
      const writes = []
      const repository = createOpportunityArchiveRepository(transactionDatabase({
        async one(sql) {
          return sql.includes('FROM mip_opportunities') ? scenario.row : null
        },
        async query(sql) {
          writes.push(sql)
          return { affectedRows: 1 }
        },
      }))
      await assert.rejects(
        () => repository.archiveOpportunity(scenario.input),
        error => error.code === scenario.code,
      )
      assert.equal(writes.length, 0)
    }
  })

  it('does not audit when the conditional update loses a race', async () => {
    const writes = []
    const repository = createOpportunityArchiveRepository(transactionDatabase({
      async one(sql) {
        return sql.includes('FROM mip_opportunities') ? opportunity() : null
      },
      async query(sql) {
        writes.push(sql)
        return { affectedRows: 0 }
      },
    }))
    await assert.rejects(
      () => repository.archiveOpportunity(archiveInput()),
      error => error.code === 'CONFLICT',
    )
    assert.equal(writes.length, 1)
    assert.match(writes[0], /UPDATE mip_opportunities/)
  })
})

describe('opportunity archive service', () => {
  it('normalizes the intent and requires a platform-scoped authorization grant', async () => {
    const captured = []
    const repository = {
      async getOpportunityArchiveScope(appId, opportunityId) {
        assert.deepEqual([appId, opportunityId], [APP_ID, OPPORTUNITY_ID])
        return { scopeType: 'BRANCH', scopeId: BRANCH_ID, branchId: BRANCH_ID, status: 'DRAFT', version: 4 }
      },
      async archiveOpportunity(input) {
        captured.push(input)
        return { id: input.opportunityId, status: 'ARCHIVED', version: 5 }
      },
    }
    const context = { caller: { appId: APP_ID, userId: ADMIN_ID }, bindings: [] }
    const service = createOpportunityArchiveService({
      repository,
      async authorize(receivedContext, scope) {
        assert.equal(receivedContext, context)
        assert.deepEqual(scope, {
          scopeType: 'BRANCH', scopeId: BRANCH_ID, branchId: BRANCH_ID, status: 'DRAFT', version: 4,
        })
        return { roleKey: 'PLATFORM_OWNER', scopeType: 'PLATFORM', scopeId: null }
      },
    })

    await service.archiveOpportunity(context, {
      opportunityId: `  ${OPPORTUNITY_ID}  `,
      expectedVersion: '4',
      reason: '  清理未使用草稿  ',
    })
    assert.deepEqual(captured, [{
      appId: APP_ID,
      actorUserId: ADMIN_ID,
      opportunityId: OPPORTUNITY_ID,
      expectedVersion: 4,
      reason: '清理未使用草稿',
      authorizedScope: { scopeType: 'BRANCH', scopeId: BRANCH_ID },
      effectiveRole: 'PLATFORM_OWNER',
      authorization: {
        capability: 'opportunities.archive',
        effectiveGrant: { roleKey: 'PLATFORM_OWNER', scopeType: 'PLATFORM', scopeId: null },
      },
    }])

    const branchService = createOpportunityArchiveService({
      repository,
      authorize: async () => ({ roleKey: 'BRANCH_ADMIN', scopeType: 'BRANCH', scopeId: BRANCH_ID }),
    })
    await assert.rejects(
      () => branchService.archiveOpportunity(context, archiveInput()),
      error => error.code === 'FORBIDDEN',
    )
    const financeService = createOpportunityArchiveService({
      repository,
      authorize: async () => ({ roleKey: 'PLATFORM_FINANCE', scopeType: 'PLATFORM', scopeId: null }),
    })
    await assert.rejects(
      () => financeService.archiveOpportunity(context, archiveInput()),
      error => error.code === 'FORBIDDEN',
    )
    assert.equal(captured.length, 1)
  })

  it('rejects invalid archive intents before any lookup', async () => {
    let reads = 0
    const service = createOpportunityArchiveService({
      repository: {
        async getOpportunityArchiveScope() {
          reads += 1
          return null
        },
        async archiveOpportunity() {},
      },
      authorize: async () => ({ roleKey: 'PLATFORM_OWNER', scopeType: 'PLATFORM' }),
    })
    for (const input of [
      { opportunityId: 'invalid', expectedVersion: 1, reason: '原因' },
      { opportunityId: OPPORTUNITY_ID, expectedVersion: 0, reason: '原因' },
      { opportunityId: OPPORTUNITY_ID, expectedVersion: 1, reason: '' },
      { opportunityId: OPPORTUNITY_ID, expectedVersion: 1, reason: 'x'.repeat(241) },
    ]) {
      await assert.rejects(
        () => service.archiveOpportunity({ appId: APP_ID, userId: ADMIN_ID }, input),
        error => error.code === 'VALIDATION_FAILED',
      )
    }
    assert.equal(reads, 0)
    assert.deepEqual(normalizeArchiveRequest({
      opportunityId: OPPORTUNITY_ID,
      expectedVersion: 2,
      reason: '内容重复',
    }), {
      opportunityId: OPPORTUNITY_ID,
      expectedVersion: 2,
      reason: '内容重复',
    })
  })
})

describe('opportunity archive API contract', () => {
  it('registers the admin action and exposes only allowlisted blocker categories', async () => {
    let received
    const result = await actions['mip.admin.opportunities.archive']({
      async archiveOpportunity(caller, event) {
        received = { caller, event }
        return { id: OPPORTUNITY_ID, status: 'ARCHIVED', version: 5 }
      },
    }, { appId: APP_ID }, { opportunityId: OPPORTUNITY_ID })
    assert.equal(result.status, 'ARCHIVED')
    assert.deepEqual(received, {
      caller: { appId: APP_ID },
      event: { opportunityId: OPPORTUNITY_ID },
    })

    const blocked = errorResponse(Object.assign(new Error('OPPORTUNITY_ARCHIVE_BLOCKED'), {
      code: 'OPPORTUNITY_ARCHIVE_BLOCKED',
      details: {
        blockers: ['ORDERS', 'ORDERS', 'PRIVATE_RECORD_ID', 'OUTBOX_EVENTS'],
      },
    }))
    assert.deepEqual(blocked.error.details, { blockers: ['ORDERS', 'OUTBOX_EVENTS'] })
    assert.equal(JSON.stringify(blocked).includes('PRIVATE_RECORD_ID'), false)
  })
})

describe('opportunity archive migration', () => {
  it('adds a constrained archive state without physical deletion', () => {
    const root = path.resolve(__dirname, '../../..')
    const migration = fs.readFileSync(
      path.join(root, 'database/mysql/mip/014_opportunity_archive.sql'),
      'utf8',
    )
    const rollback = fs.readFileSync(
      path.join(root, 'database/mysql/mip/rollback/014_opportunity_archive.sql'),
      'utf8',
    )
    assert.match(migration, /status IN \('DRAFT', 'PUBLISHED', 'ENDED', 'UNPUBLISHED', 'ARCHIVED'\)/)
    assert.match(migration, /archived_by_user_id/)
    assert.match(migration, /mip_opportunities_archive_ck/)
    assert.match(migration, /REFERENCES mip_users \(app_id, id\) ON DELETE RESTRICT/)
    assert.doesNotMatch(migration, /\bDELETE\s+FROM\b/i)
    assert.match(rollback, /fails closed while any archived opportunity remains/)
    assert.doesNotMatch(rollback, /\b(?:UPDATE|DELETE)\s+mip_/i)
  })
})
