'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const {
  adminIssueCheckInCredential,
  checkIn,
  parseCheckInToken,
  resolveCheckInScene,
} = require('../domain/event-service')
const { readSignedToken } = require('../lib/tokens')

const TOKEN_SECRET = 'check-in-resume-token-secret-at-least-32-characters'
const CALLER_KEY = 'caller-identity-key'
const USER_ID = '20000000-0000-4000-8000-000000000001'

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
    const resolved = await resolveCheckInScene(database, {
      appId: 'wx-app',
      userId: USER_ID,
      callerKey: CALLER_KEY,
      scene,
      tokenSecret: TOKEN_SECRET,
      now: new Date('2026-08-24T03:00:00.000Z'),
    })
    assert.deepEqual({
      eventId: resolved.eventId,
      validFrom: resolved.validFrom,
      validUntil: resolved.validUntil,
    }, {
      eventId: '10000000-0000-4000-8000-000000000001',
      validFrom: '2026-08-24T02:00:00.000Z',
      validUntil: '2026-08-24T03:30:00.000Z',
    })
    assert.match(resolved.resumeToken, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/)
    assert.equal(resolved.resumeToken.includes(scene), false)
    assert.equal(resolved.resumeToken.includes(USER_ID), false)
    assert.equal(resolved.resumeToken.includes(CALLER_KEY), false)
    const payload = readSignedToken(
      resolved.resumeToken,
      TOKEN_SECRET,
      'event-checkin-resume',
      new Date('2026-08-24T03:00:00.000Z'),
    )
    assert.equal(payload.eventId, resolved.eventId)
    assert.equal(payload.credentialRef, 'abcdefghijk')
    assert.equal(payload.expiresAt, resolved.validUntil)
    assert.equal(payload.userId, undefined)
    assert.equal(parseCheckInToken(scene).reference, 'abcdefghijk')
    assert.throws(() => parseCheckInToken('bad.scene'), error => error.code === 'VALIDATION_FAILED')
  })

  it('rejects a tampered, expired, cross-AppID, or cross-caller resume token before touching data', async () => {
    let index = 0
    const database = {
      async one() {
        index += 1
        return index === 1
          ? {
              id: '40000000-0000-4000-8000-000000000001',
              event_id: '10000000-0000-4000-8000-000000000001',
              valid_from: '2026-08-24T02:00:00.000Z',
              valid_until: '2026-08-24T05:00:00.000Z',
            }
          : { id: '10000000-0000-4000-8000-000000000001' }
      },
    }
    const resolved = await resolveCheckInScene(database, {
      appId: 'wx-app',
      userId: USER_ID,
      callerKey: CALLER_KEY,
      scene: 's1.abcdefghijk.lmnopqrstuv',
      tokenSecret: TOKEN_SECRET,
      now: new Date('2026-08-24T03:00:00.000Z'),
    })
    let transactions = 0
    const noDatabase = {
      transaction() {
        transactions += 1
        throw new Error('must not start a transaction')
      },
    }
    const input = {
      appId: 'wx-app',
      userId: USER_ID,
      callerKey: CALLER_KEY,
      resumeToken: resolved.resumeToken,
      tokenSecret: TOKEN_SECRET,
      idempotencyKey: 'resume-negative-test',
      now: new Date('2026-08-24T03:01:00.000Z'),
    }
    const last = resolved.resumeToken.at(-1)
    const tampered = `${resolved.resumeToken.slice(0, -1)}${last === 'a' ? 'b' : 'a'}`
    for (const override of [
      { resumeToken: tampered },
      { appId: 'wx-other-app' },
      { callerKey: 'other-caller' },
      { now: new Date('2026-08-24T03:31:00.000Z') },
    ]) {
      await assert.rejects(
        checkIn(noDatabase, { ...input, ...override }),
        error => error.code === 'VALIDATION_FAILED',
      )
    }
    assert.equal(transactions, 0)
  })

  it('rejects a signed resume token when its credential has been rebound to another event', async () => {
    let index = 0
    const issued = await resolveCheckInScene({
      async one() {
        index += 1
        return index === 1
          ? {
              id: '40000000-0000-4000-8000-000000000001',
              event_id: '10000000-0000-4000-8000-000000000001',
              valid_from: '2026-08-24T02:00:00.000Z',
              valid_until: '2026-08-24T05:00:00.000Z',
            }
          : { id: '10000000-0000-4000-8000-000000000001' }
      },
    }, {
      appId: 'wx-app',
      userId: USER_ID,
      callerKey: CALLER_KEY,
      scene: 's1.abcdefghijk.lmnopqrstuv',
      tokenSecret: TOKEN_SECRET,
      now: new Date('2026-08-24T03:00:00.000Z'),
    })
    const tx = {
      async one(sql) {
        if (sql.includes('FROM mip_users')) return { id: USER_ID, status: 'ACTIVE' }
        if (sql.includes('mip_event_checkin_credentials')) {
          return {
            id: '40000000-0000-4000-8000-000000000001',
            event_id: '90000000-0000-4000-8000-000000000009',
            status: 'ACTIVE',
            valid_from: '2026-08-24T02:00:00.000Z',
            valid_until: '2026-08-24T05:00:00.000Z',
          }
        }
        throw new Error(`unexpected query: ${sql}`)
      },
      async query() { return { affectedRows: 1 } },
    }
    await assert.rejects(
      checkIn({ transaction: work => work(tx) }, {
        appId: 'wx-app',
        userId: USER_ID,
        callerKey: CALLER_KEY,
        resumeToken: issued.resumeToken,
        tokenSecret: TOKEN_SECRET,
        idempotencyKey: 'cross-event-resume',
        participationAccessPolicy: { requireAccess: async () => ({}) },
        now: new Date('2026-08-24T03:01:00.000Z'),
      }),
      error => error.code === 'VALIDATION_FAILED' && /活动不一致/.test(error.message),
    )
  })
})
