'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const { listOperationalExceptions } = require('../domain/operational-exceptions')

describe('operational exception center', () => {
  it('normalizes five durable exception sources without exposing identities', async () => {
    let call = 0
    const statements = []
    const database = {
      async query(sql) {
        statements.push(sql)
        call += 1
        if (call === 1) {
          return [{
            id: 'refund-1',
            status: 'REFUND_FAILED',
            description: '活动报名',
            order_id: 'order-1',
            created_at: '2026-07-25T00:00:00Z',
            updated_at: '2026-07-25T00:10:00Z',
          }]
        }
        return []
      },
    }
    const rows = await listOperationalExceptions(database, 'wx-app')
    assert.equal(rows.length, 1)
    assert.equal(rows[0].type, 'REFUND')
    assert.equal(rows[0].canRetry, false)
    assert.equal(Object.hasOwn(rows[0], 'userId'), false)
    assert.match(statements[1], /lease_until < UTC_TIMESTAMP/)
    assert.doesNotMatch(statements[1], /lease_expires_at/)
  })
})
