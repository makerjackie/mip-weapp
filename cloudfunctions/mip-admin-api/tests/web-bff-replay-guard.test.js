'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const {
  WEB_BFF_REPLAY_CLEANUP_INTERVAL_MS,
  WEB_BFF_REPLAY_TTL_MS,
  createWebBffReplayGuard,
} = require('../lib/web-bff-replay-guard')

const NOW = Date.UTC(2030, 0, 1)
const INPUT = Object.freeze({
  appId: 'wx-mip-app',
  nonce: '0123456789abcdefghijklmn',
  principalIdentityKey: 'a'.repeat(64),
  action: 'mip.admin.users.get',
  requestHash: 'b'.repeat(64),
})

describe('Web BFF replay guard', () => {
  it('persists a signed envelope nonce before it can reach the application', async () => {
    const calls = []
    const guard = createWebBffReplayGuard({
      database: {
        async query(sql, params) {
          calls.push({ sql, params })
          return []
        },
      },
      now: () => NOW,
    })

    await guard.consume(INPUT)

    assert.equal(calls.length, 2)
    assert.match(calls[0].sql, /DELETE FROM mip_web_bff_requests/)
    assert.match(calls[1].sql, /INSERT INTO mip_web_bff_requests/)
    assert.deepEqual(calls[1].params.slice(0, 5), [
      INPUT.appId,
      INPUT.nonce,
      INPUT.principalIdentityKey,
      INPUT.action,
      INPUT.requestHash,
    ])
    assert.equal(calls[1].params[5].toISOString(), new Date(NOW + WEB_BFF_REPLAY_TTL_MS).toISOString())
  })

  it('throttles expired-row cleanup within one warm function instance', async () => {
    let clock = NOW
    const calls = []
    const guard = createWebBffReplayGuard({
      database: { query: async sql => calls.push(sql) },
      now: () => clock,
    })

    await guard.consume(INPUT)
    clock += WEB_BFF_REPLAY_CLEANUP_INTERVAL_MS - 1
    await guard.consume({ ...INPUT, nonce: '1123456789abcdefghijklmn' })

    assert.equal(calls.filter(sql => sql.includes('DELETE FROM')).length, 1)
    assert.equal(calls.filter(sql => sql.includes('INSERT INTO')).length, 2)
  })

  it('rejects a reused nonce and fails closed when persistence is unavailable', async () => {
    const duplicate = createWebBffReplayGuard({
      database: {
        async query(sql) {
          if (sql.includes('INSERT INTO')) throw Object.assign(new Error('duplicate'), { code: 'ER_DUP_ENTRY' })
        },
      },
      now: () => NOW,
    })
    const unavailable = createWebBffReplayGuard({
      database: { query: async () => { throw new Error('offline') } },
      now: () => NOW,
    })

    await assert.rejects(duplicate.consume(INPUT), /WEB_BFF_REPLAYED/)
    await assert.rejects(unavailable.consume(INPUT), /WEB_BFF_REPLAY_GUARD_UNAVAILABLE/)
  })

  it('rejects malformed persistence facts before touching MySQL', async () => {
    let calls = 0
    const guard = createWebBffReplayGuard({
      database: { query: async () => { calls += 1 } },
      now: () => NOW,
    })

    await assert.rejects(
      guard.consume({ ...INPUT, principalIdentityKey: 'openid-admin' }),
      /WEB_BFF_REPLAY_GUARD_INPUT_INVALID/,
    )
    assert.equal(calls, 0)
  })
})
