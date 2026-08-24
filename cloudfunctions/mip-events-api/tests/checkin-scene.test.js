'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const {
  adminIssueCheckInCredential,
  parseCheckInToken,
  resolveCheckInScene,
} = require('../domain/event-service')

describe('MIP check-in scene', () => {
  it('issues a short AppID-scoped scene after admin authorization', async () => {
    const calls = []
    const tx = {
      async one(sql) {
        calls.push(String(sql))
        if (String(sql).includes('FROM mip_users')) {
          return { id: '20000000-0000-4000-8000-000000000001', status: 'ACTIVE' }
        }
        return { id: '10000000-0000-4000-8000-000000000001', branch_id: null, status: 'PUBLISHED', starts_at: '2026-08-24T08:00:00.000Z', ends_at: '2026-08-24T10:00:00.000Z' }
      },
      async query(sql, params) {
        calls.push(String(sql))
        if (String(sql).includes('FROM mip_admin_role_bindings')) {
          return [{ scope_type: 'PLATFORM', scope_id: null, role_key: 'PLATFORM_OWNER' }]
        }
        if (String(sql).includes('INSERT INTO mip_event_checkin_credentials')) {
          assert.equal(params[3].length, 11)
        }
        return { affectedRows: 1 }
      },
    }
    const result = await adminIssueCheckInCredential({ transaction: work => work(tx) }, {
      appId: 'wx-app',
      userId: '20000000-0000-4000-8000-000000000001',
      eventId: '10000000-0000-4000-8000-000000000001',
      now: new Date('2026-08-24T07:00:00.000Z'),
    })
    assert.match(result.scanToken, /^s1\.[A-Za-z0-9_-]{11}\.[A-Za-z0-9_-]{11}$/)
    assert.ok(result.scanToken.length <= 32)
    assert.equal(result.scanToken.includes(result.credentialId), false)
    assert.ok(calls.some(sql => sql.includes('scan_key')))
  })

  it('issues a five-minute rotating scene and revokes the previous active rotating scene', async () => {
    const calls = []
    const tx = {
      async one(sql) {
        if (String(sql).includes('FROM mip_users')) {
          return { id: '20000000-0000-4000-8000-000000000001', status: 'ACTIVE' }
        }
        return { id: '10000000-0000-4000-8000-000000000001', branch_id: null, status: 'PUBLISHED', starts_at: '2026-08-24T08:00:00.000Z', ends_at: '2026-08-24T10:00:00.000Z' }
      },
      async query(sql) {
        calls.push(String(sql).replace(/\s+/g, ' ').trim())
        if (String(sql).includes('FROM mip_admin_role_bindings')) {
          return [{ scope_type: 'PLATFORM', scope_id: null, role_key: 'PLATFORM_OWNER' }]
        }
        return { affectedRows: 1 }
      },
    }
    const now = new Date('2026-08-24T07:00:00.000Z')
    const result = await adminIssueCheckInCredential({ transaction: work => work(tx) }, {
      appId: 'wx-app',
      userId: '20000000-0000-4000-8000-000000000001',
      eventId: '10000000-0000-4000-8000-000000000001',
      mode: 'ROTATING',
      now,
    })
    assert.equal(result.mode, 'ROTATING')
    assert.equal(Date.parse(result.validUntil) - Date.parse(result.validFrom), 5 * 60 * 1000)
    assert.ok(calls.some(sql => sql.includes("SET status = 'REVOKED'") && sql.includes("mode = 'ROTATING'")))
  })

  it('resolves an active short scene to a published event without exposing database identities', async () => {
    let index = 0
    const database = {
      async one(sql, params) {
        index += 1
        if (index === 1) {
          assert.match(sql, /scan_key/)
          assert.match(sql, /valid_from <= \? AND valid_until >= \?/)
          assert.equal(params[0], 'wx-app')
          return {
            event_id: '10000000-0000-4000-8000-000000000001',
            valid_from: '2026-08-24T02:00:00.000Z',
            valid_until: '2026-08-25T10:00:00.000Z',
          }
        }
        return { id: '10000000-0000-4000-8000-000000000001' }
      },
    }
    const scene = 's1.abcdefghijk.lmnopqrstuv'
    assert.deepEqual(await resolveCheckInScene(database, {
      appId: 'wx-app',
      scene,
      now: new Date('2026-08-24T03:00:00.000Z'),
    }), {
      eventId: '10000000-0000-4000-8000-000000000001',
      scanToken: scene,
      validFrom: '2026-08-24T02:00:00.000Z',
      validUntil: '2026-08-25T10:00:00.000Z',
    })
    assert.equal(parseCheckInToken(scene).reference, 'abcdefghijk')
    assert.throws(() => parseCheckInToken('bad.scene'), error => error.code === 'VALIDATION_FAILED')
  })
})
