'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const { CAPABILITIES } = require('../domain/capabilities')
const { createAdminRepository } = require('../domain/repository')

describe('export ticket creation idempotency', () => {
  it('replays the original one-time ticket without inserting a second export', async () => {
    let nextId = 0
    let stored = null
    const writes = []
    const tx = {
      async one(sql) {
        if (sql.includes('FROM mip_idempotency_keys')) return stored
        if (sql.includes('FROM mip_users')) return { id: 'admin-a', status: 'ACTIVE' }
        if (sql.includes('FROM mip_admin_role_bindings')) {
          return {
            scope_type: 'PLATFORM',
            scope_id: '00000000-0000-0000-0000-000000000000',
            role_key: 'PLATFORM_OWNER',
            status: 'ACTIVE',
            policy_capabilities_json: null,
          }
        }
        throw new Error(`unexpected read: ${sql}`)
      },
      async query(sql, params) {
        writes.push({ sql, params })
        if (sql.includes('INSERT INTO mip_idempotency_keys')) {
          if (stored) {
            const error = new Error('duplicate')
            error.code = 'ER_DUP_ENTRY'
            throw error
          }
          stored = { request_hash: params[5], status: 'RUNNING', response_json: null }
        }
        if (sql.includes('UPDATE mip_idempotency_keys')) {
          stored = { request_hash: params[5], status: 'COMPLETED', response_json: params[0] }
        }
        return { affectedRows: 1 }
      },
    }
    const repository = createAdminRepository({
      one: tx.one,
      query: tx.query,
      transaction: work => work(tx),
    }, {
      id: () => `generated-${++nextId}`,
      randomBytes: () => Buffer.alloc(32, 7),
    })
    const input = {
      appId: 'wx-mip-app',
      actorUserId: 'admin-a',
      idempotencyKey: 'web-export-create-0001',
      exportType: 'USERS',
      scope: { scopeType: 'PLATFORM', scopeId: null },
      filters: { query: '深圳' },
      includesPhone: false,
      authorizedScope: { scopeType: 'PLATFORM', scopeId: null },
      authorization: {
        capability: CAPABILITIES.EXPORT_CREATE,
        effectiveGrant: { roleKey: 'PLATFORM_OWNER', scopeType: 'PLATFORM', scopeId: null },
      },
      now: new Date('2030-01-01T00:00:00.000Z'),
      audit: {
        appId: 'wx-mip-app', actorUserId: 'admin-a', scopeType: 'PLATFORM', scopeId: null,
        action: 'admin.export.request', resourceType: 'EXPORT_TICKET', effectiveRole: 'PLATFORM_OWNER', metadata: {},
      },
    }

    const first = await repository.createExportTicket(input)
    const replay = await repository.createExportTicket(input)

    assert.deepEqual(replay, { ...first, idempotent: true })
    assert.equal(writes.filter(item => item.sql.includes('INSERT INTO mip_admin_export_tickets')).length, 1)
    assert.equal(writes.filter(item => item.sql.includes('INSERT INTO mip_audit_logs')).length, 1)
  })
})
