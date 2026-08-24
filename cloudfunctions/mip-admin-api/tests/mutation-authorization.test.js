'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const { CAPABILITIES } = require('../domain/capabilities')
const { createAdminRepository } = require('../domain/repository')

const appId = 'wx-transaction-authorization'
const actorUserId = 'actor-user'
const eventId = 'event-a'

function authorization(roleKey, scopeType, scopeId, capability) {
  return {
    capability,
    effectiveGrant: { roleKey, scopeType, scopeId },
  }
}

function databaseFor(one) {
  const reads = []
  const writes = []
  const tx = {
    async one(sql, params) {
      reads.push({ sql, params })
      return one(sql, params)
    },
    async query(sql, params) {
      writes.push({ sql, params })
      return { affectedRows: 1 }
    },
  }
  return {
    database: {
      one: tx.one,
      query: tx.query,
      transaction: work => work(tx),
    },
    reads,
    writes,
  }
}

function statusMutation(overrides = {}) {
  return {
    appId,
    actorUserId,
    eventId,
    expectedVersion: 2,
    status: 'UNPUBLISHED',
    reason: '',
    authorization: authorization(
      'BRANCH_ADMIN',
      'BRANCH',
      'branch-a',
      CAPABILITIES.EVENTS_WRITE,
    ),
    authorizedScope: {
      scopeType: 'EVENT',
      scopeId: eventId,
      branchId: 'branch-a',
    },
    audit: {},
    ...overrides,
  }
}

function exportDownloadMutation(overrides = {}) {
  return {
    appId,
    actorUserId,
    ticketId: 'ticket-a',
    tokenHash: 'a'.repeat(64),
    now: new Date('2026-08-24T00:00:00.000Z'),
    reservedUntil: new Date('2026-08-24T00:02:00.000Z'),
    includesPhone: false,
    authorization: authorization(
      'PLATFORM_OWNER',
      'PLATFORM',
      null,
      CAPABILITIES.EXPORT_CREATE,
    ),
    authorizedScope: { scopeType: 'PLATFORM', scopeId: null },
    audit: {
      appId,
      actorUserId,
      scopeType: 'PLATFORM',
      scopeId: null,
      action: 'admin.export.download.reserve',
      resourceType: 'EXPORT_TICKET',
      resourceId: 'ticket-a',
      effectiveRole: 'PLATFORM_OWNER',
      metadata: {},
    },
    ...overrides,
  }
}

function exportTicketRow(overrides = {}) {
  return {
    id: 'ticket-a',
    app_id: appId,
    requested_by_user_id: actorUserId,
    export_type: 'USERS',
    scope_type: 'PLATFORM',
    scope_id: null,
    filters_json: '{}',
    includes_phone: 0,
    object_key: 'mip/exports/scope/ticket-a.xlsx',
    cloud_file_id: 'cloud://test/mip/exports/scope/ticket-a.xlsx',
    content_sha256: 'b'.repeat(64),
    content_bytes: 512,
    row_count: 3,
    status: 'READY',
    reserved_until: null,
    expires_at: new Date('2026-08-24T00:15:00.000Z'),
    consumed_at: null,
    failed_reason_code: null,
    created_at: new Date('2026-08-24T00:00:00.000Z'),
    ...overrides,
  }
}

describe('admin mutation transaction authorization', () => {
  it('writes no business state when the exact effective role was revoked after service authorization', async () => {
    const harness = databaseFor((sql) => {
      if (sql.includes('FROM mip_users')) return { id: actorUserId, status: 'ACTIVE' }
      if (sql.includes('FROM mip_admin_role_bindings')) {
        return {
          scope_type: 'BRANCH', scope_id: 'branch-a', role_key: 'BRANCH_ADMIN', status: 'REVOKED',
        }
      }
      throw new Error(`unexpected read: ${sql}`)
    })
    const repository = createAdminRepository(harness.database)

    await assert.rejects(() => repository.changeEventStatus(statusMutation()), error => error?.code === 'FORBIDDEN')

    assert.equal(harness.writes.length, 0)
    assert.equal(harness.reads.length, 2)
    assert.match(harness.reads[0].sql, /FROM mip_users[\s\S]*FOR UPDATE/)
    assert.match(harness.reads[1].sql, /FROM mip_admin_role_bindings[\s\S]*FOR UPDATE/)
  })

  it('writes no business state when an event moved branches after service authorization', async () => {
    const harness = databaseFor((sql) => {
      if (sql.includes('FROM mip_users')) return { id: actorUserId, status: 'ACTIVE' }
      if (sql.includes('FROM mip_admin_role_bindings')) {
        return {
          scope_type: 'PLATFORM',
          scope_id: '00000000-0000-0000-0000-000000000000',
          role_key: 'PLATFORM_OPERATIONS',
          status: 'ACTIVE',
        }
      }
      if (sql.includes('FROM mip_events')) {
        return {
          id: eventId,
          branch_id: 'branch-b',
          status: 'PUBLISHED',
          content_safety_status: 'PASSED',
          starts_at: new Date('2026-09-01T00:00:00.000Z'),
          version: 2,
        }
      }
      throw new Error(`unexpected read: ${sql}`)
    })
    const repository = createAdminRepository(harness.database)

    await assert.rejects(() => repository.changeEventStatus(statusMutation({
      authorization: authorization(
        'PLATFORM_OPERATIONS',
        'PLATFORM',
        null,
        CAPABILITIES.EVENTS_WRITE,
      ),
    })), error => error?.code === 'CONFLICT')

    assert.equal(harness.writes.length, 0)
    assert.equal(harness.reads.length, 3)
    assert.match(harness.reads[2].sql, /FROM mip_events[\s\S]*FOR UPDATE/)
  })

  it('rechecks the independent phone grant before an export ticket transition', async () => {
    const harness = databaseFor((sql, params) => {
      if (sql.includes('FROM mip_users')) return { id: actorUserId, status: 'ACTIVE' }
      if (sql.includes('FROM mip_admin_role_bindings')) {
        const roleKey = params[4]
        return {
          scope_type: 'EVENT',
          scope_id: eventId,
          role_key: roleKey,
          status: roleKey === 'EVENT_OWNER' ? 'REVOKED' : 'ACTIVE',
        }
      }
      throw new Error(`ticket must not be locked after phone authorization was revoked: ${sql}`)
    })
    const repository = createAdminRepository(harness.database)
    const lease = new Date('2026-08-24T00:01:00.000Z')

    await assert.rejects(() => repository.finishExportBuild({
      appId,
      actorUserId,
      ticketId: 'ticket-a',
      tokenHash: 'a'.repeat(64),
      reservedUntil: lease,
      fileId: 'cloud://test/export.xlsx',
      contentSha256: 'b'.repeat(64),
      contentBytes: 512,
      rowCount: 3,
      now: new Date('2026-08-24T00:00:30.000Z'),
      includesPhone: true,
      authorization: authorization(
        'EVENT_MANAGER',
        'EVENT',
        eventId,
        CAPABILITIES.EXPORT_CREATE,
      ),
      phoneAuthorization: authorization(
        'EVENT_OWNER',
        'EVENT',
        eventId,
        CAPABILITIES.USERS_PHONE_READ,
      ),
      authorizedScope: { scopeType: 'EVENT', scopeId: eventId, branchId: 'branch-a' },
      audit: {},
    }), error => error?.code === 'FORBIDDEN')

    assert.equal(harness.writes.length, 0)
    assert.equal(harness.reads.length, 4)
    assert.equal(harness.reads.filter(read => read.sql.includes('FROM mip_admin_role_bindings')).length, 2)
    assert.equal(harness.reads.some(read => read.sql.includes('FROM mip_admin_export_tickets')), false)
  })

  it('rejects a download before storage access when account closure committed first', async () => {
    let storageAccessed = false
    const harness = databaseFor((sql) => {
      if (sql.includes('FROM mip_users')) return { id: actorUserId, status: 'CLOSED' }
      throw new Error(`storage authorization must stop at the closed user: ${sql}`)
    })
    const repository = createAdminRepository(harness.database)

    await assert.rejects(
      () => repository.issueExportDownload(exportDownloadMutation(), async () => {
        storageAccessed = true
        return { state: 'ISSUED', value: { tempUrl: 'https://example.test/export.xlsx' } }
      }),
      error => error?.code === 'FORBIDDEN',
    )

    assert.equal(storageAccessed, false)
    assert.equal(harness.writes.length, 0)
    assert.equal(harness.reads.length, 1)
    assert.match(harness.reads[0].sql, /FROM mip_users[\s\S]*FOR UPDATE/)
  })

  it('keeps the final authorization transaction open through URL issuance and audit', async () => {
    const sequence = []
    let continueIssuance
    let markIssuanceStarted
    const issuanceStarted = new Promise((resolve) => { markIssuanceStarted = resolve })
    const issuanceBlocked = new Promise((resolve) => { continueIssuance = resolve })
    const tx = {
      async one(sql) {
        if (sql.includes('FROM mip_users')) {
          sequence.push('user-lock')
          return { id: actorUserId, status: 'ACTIVE' }
        }
        if (sql.includes('FROM mip_admin_role_bindings')) {
          sequence.push('role-lock')
          return {
            scope_type: 'PLATFORM',
            scope_id: '00000000-0000-0000-0000-000000000000',
            role_key: 'PLATFORM_OWNER',
            status: 'ACTIVE',
          }
        }
        if (sql.includes('FROM mip_admin_export_tickets')) {
          sequence.push('ticket-lock')
          return exportTicketRow()
        }
        throw new Error(`unexpected read: ${sql}`)
      },
      async query(sql) {
        if (sql.includes("SET status = 'RESERVED'")) sequence.push('ticket-reserved')
        else if (sql.includes('INSERT INTO mip_audit_logs')) sequence.push('audit-written')
        else throw new Error(`unexpected write: ${sql}`)
        return { affectedRows: 1 }
      },
    }
    const database = {
      one: tx.one,
      query: tx.query,
      async transaction(work, attempts) {
        sequence.push(`transaction-begin:${attempts}`)
        const result = await work(tx)
        sequence.push('transaction-commit')
        return result
      },
    }
    const repository = createAdminRepository(database)
    const pending = repository.issueExportDownload(exportDownloadMutation(), async () => {
      sequence.push('storage-start')
      markIssuanceStarted()
      await issuanceBlocked
      sequence.push('url-issued')
      return { state: 'ISSUED', value: { tempUrl: 'https://example.test/export.xlsx' } }
    })

    await issuanceStarted
    assert.deepEqual(sequence, [
      'transaction-begin:1',
      'user-lock',
      'role-lock',
      'ticket-lock',
      'storage-start',
    ])
    continueIssuance()
    const result = await pending

    assert.equal(result.state, 'RESERVED')
    assert.deepEqual(sequence, [
      'transaction-begin:1',
      'user-lock',
      'role-lock',
      'ticket-lock',
      'storage-start',
      'url-issued',
      'ticket-reserved',
      'audit-written',
      'transaction-commit',
    ])
  })
})
