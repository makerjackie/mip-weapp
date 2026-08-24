'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const { createGrowthRepository } = require('../domain/repository')

const input = {
  appId: 'wx-app',
  userId: '10000000-0000-4000-8000-000000000001',
  sourceEventType: 'event.checked_in',
  sourceEventId: '20000000-0000-4000-8000-000000000001',
}

test('records a capped award and account update in one transaction', async () => {
  const queries = []
  const tx = {
    async one(sql) {
      if (sql.includes('mip_idempotency_keys')) return null
      if (sql.includes('FROM mip_users')) return { id: input.userId, status: 'ACTIVE' }
      if (sql.includes('FROM mip_growth_accounts')) {
        return { user_id: input.userId, experience_balance: 90, contribution_balance: 0, coin_balance: 0, version: 1 }
      }
      if (sql.includes('FROM mip_growth_entries') && sql.includes('source_event_id')) return null
      if (sql.includes('COALESCE(SUM')) return { total: 25 }
      throw new Error(`unexpected one: ${sql}`)
    },
    async query(sql, params) {
      queries.push({ sql, params })
      if (sql.includes('FROM mip_growth_rules')) {
        return [{
          id: '30000000-0000-4000-8000-000000000001',
          rule_key: 'event-check-in',
          name: '活动签到',
          metric: 'EXPERIENCE',
          delta_value: 20,
          daily_limit_value: 30,
          source_event_type: 'event.checked_in',
          status: 'ACTIVE',
        }]
      }
      return { affectedRows: 1 }
    },
  }
  const database = {
    transaction: async work => work(tx),
  }
  const ids = [
    '40000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000001',
    '60000000-0000-4000-8000-000000000001',
  ]
  const repository = createGrowthRepository(database, { createId: () => ids.shift() })
  const result = await repository.recordConfirmedEvent(input)
  assert.equal(result.awards[0].appliedDelta, 5)
  assert.equal(result.awards[0].balanceAfter, 95)
  assert.ok(queries.some(item => item.sql.includes('UPDATE mip_growth_accounts')))
  assert.ok(queries.some(item => item.sql.includes('INSERT INTO mip_growth_entries')))
  assert.ok(queries.some(item => item.sql.includes("'GROWTH_ENTRY'") && item.sql.includes("'growth.changed'")))
  assert.ok(queries.some(item => item.sql.includes("status = 'COMPLETED'")))
})

test('returns a completed idempotent response without writing another entry', async () => {
  let queryCount = 0
  const response = { sourceEventId: input.sourceEventId, awards: [{ appliedDelta: 5 }] }
  const database = {
    transaction: async work => work({
      async one(sql) {
        if (sql.includes('mip_idempotency_keys')) {
          const { createHash } = require('node:crypto')
          return {
            request_hash: createHash('sha256')
              .update(`${input.appId}\0${input.userId}\0${input.sourceEventType}:${input.sourceEventId}`)
              .digest('hex'),
            status: 'COMPLETED',
            response_json: JSON.stringify(response),
          }
        }
        return null
      },
      async query() {
        queryCount += 1
      },
    }),
  }
  const result = await createGrowthRepository(database).recordConfirmedEvent(input)
  assert.deepEqual(result, response)
  assert.equal(queryCount, 0)
})
