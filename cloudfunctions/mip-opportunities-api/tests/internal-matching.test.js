'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const { sign } = require('../../mip-admin-api/lib/matching-client')
const { authorizeInternalMatching, verifyInternalMatching } = require('../lib/internal-matching')

const SECRET = 'matching-internal-secret-with-32-characters'
const NOW = 1_777_000_000_000

function signedRequest(overrides = {}) {
  const event = {
    action: 'recalculateMatchingInternal',
    appId: 'wx-matching-test',
    actorUserId: '10000000-0000-4000-8000-000000000001',
    requesterUserId: '20000000-0000-4000-8000-000000000001',
    opportunityId: '30000000-0000-4000-8000-000000000001',
    sourceVersion: 4,
    idempotencyKey: 'admin-recalculate-0001',
    nonce: '1234567890abcdef12345678',
    timestamp: NOW,
    ...overrides,
  }
  return { ...event, signature: sign(event, SECRET) }
}

describe('internal matching authorization', () => {
  it('accepts a current request signed by the admin adapter', () => {
    assert.deepEqual(verifyInternalMatching(signedRequest(), {
      secret: SECRET,
      now: () => NOW,
    }), {
      appId: 'wx-matching-test',
      actorUserId: '10000000-0000-4000-8000-000000000001',
      requesterUserId: '20000000-0000-4000-8000-000000000001',
      opportunityId: '30000000-0000-4000-8000-000000000001',
      sourceVersion: 4,
      idempotencyKey: 'admin-recalculate-0001',
    })
  })

  it('rejects stale and tampered requests', () => {
    assert.throws(() => verifyInternalMatching(signedRequest({ timestamp: NOW - 300_001 }), {
      secret: SECRET,
      now: () => NOW,
    }), /AUTH_REQUIRED/)
    assert.throws(() => verifyInternalMatching({
      ...signedRequest(),
      requesterUserId: '40000000-0000-4000-8000-000000000001',
    }, {
      secret: SECRET,
      now: () => NOW,
    }), /AUTH_REQUIRED/)
  })

  it('re-derives current platform or exact-branch permission at the receiver', async () => {
    const queries = []
    const request = verifyInternalMatching(signedRequest(), { secret: SECRET, now: () => NOW })
    const database = {
      async one(sql) {
        queries.push(sql)
        return { id: request.actorUserId, status: 'ACTIVE' }
      },
      async query(sql) {
        queries.push(sql)
        return [{
          role_key: 'BRANCH_ADMIN',
          scope_type: 'BRANCH',
          scope_id: '40000000-0000-4000-8000-000000000001',
          policy_mode: 'CUSTOM',
          capabilities_json: JSON.stringify(['opportunities.moderate']),
        }]
      },
    }
    const result = await authorizeInternalMatching(database, request, {
      owner_user_id: request.requesterUserId,
      branch_id: '40000000-0000-4000-8000-000000000001',
      version: 4,
      status: 'PUBLISHED',
    }, { lock: true })

    assert.deepEqual(result, { requesterUserId: request.requesterUserId })
    assert.equal(queries.every(sql => sql.includes('FOR UPDATE')), true)
  })

  it('rejects revoked scope, changed source authority, and removed custom capability', async () => {
    const request = verifyInternalMatching(signedRequest(), { secret: SECRET, now: () => NOW })
    await assert.rejects(() => authorizeInternalMatching({
      one: async () => ({ id: request.actorUserId, status: 'ACTIVE' }),
      query: async () => [{
        role_key: 'BRANCH_ADMIN',
        scope_type: 'BRANCH',
        scope_id: '50000000-0000-4000-8000-000000000001',
        policy_mode: 'CUSTOM',
        capabilities_json: '[]',
      }],
    }, request, {
      owner_user_id: request.requesterUserId,
      branch_id: '40000000-0000-4000-8000-000000000001',
      version: 4,
      status: 'PUBLISHED',
    }), /AUTH_REQUIRED/)

    await assert.rejects(() => authorizeInternalMatching({
      one: async () => { throw new Error('must not query') },
      query: async () => { throw new Error('must not query') },
    }, request, {
      owner_user_id: request.requesterUserId,
      branch_id: null,
      version: 5,
      status: 'PUBLISHED',
    }), /CONFLICT/)
  })
})
