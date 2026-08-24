'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const { createGameCoinRepository } = require('../domain/game-coins')

const base = {
  action: 'grantGameCoins',
  appId: 'wx-app',
  userId: '10000000-0000-4000-8000-000000000001',
  sourceEventType: 'game.match_won',
  sourceEventId: '20000000-0000-4000-8000-000000000001',
}

test('grants a fixed server amount and appends a GAME notification outbox fact', async () => {
  const writes = []
  const ids = [
    '30000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000001',
  ]
  const tx = {
    async one(sql) {
      if (sql.includes('FROM mip_users')) return { id: base.userId, status: 'ACTIVE' }
      if (sql.includes('FROM mip_growth_entries')) return null
      if (sql.includes('FROM mip_growth_accounts')) return { coin_balance: 15, version: 3 }
      throw new Error(`unexpected query: ${sql}`)
    },
    async query(sql, params) {
      writes.push({ sql, params })
      return { affectedRows: 1 }
    },
  }
  const repository = createGameCoinRepository({ transaction: work => work(tx) }, {
    createId: () => ids.shift(),
  })
  const result = await repository.recordGameCoinEvent(base)
  assert.deepEqual(result, {
    entryId: '30000000-0000-4000-8000-000000000001',
    sourceEventType: 'game.match_won',
    deltaValue: 10,
    balanceAfter: 25,
    idempotent: false,
  })
  assert.ok(writes.some(item => item.sql.includes("metric, delta_value") && item.sql.includes("'COIN'")))
  assert.ok(writes.some(item => item.sql.includes("'game.coin_changed'")))
  assert.equal(writes.some(item => JSON.stringify(item.params).includes('999999')), false)
})

test('returns the immutable ledger result on retry', async () => {
  let writes = 0
  const repository = createGameCoinRepository({
    transaction: work => work({
      async one(sql) {
        if (sql.includes('FROM mip_users')) return { id: base.userId, status: 'ACTIVE' }
        return {
          id: '30000000-0000-4000-8000-000000000001',
          delta_value: 10,
          balance_after: 25,
          created_at: new Date(),
        }
      },
      async query() { writes += 1 },
    }),
  })
  assert.equal((await repository.recordGameCoinEvent(base)).idempotent, true)
  assert.equal(writes, 0)
})

test('rejects a spend that would create a negative balance', async () => {
  const repository = createGameCoinRepository({
    transaction: work => work({
      async one(sql) {
        if (sql.includes('FROM mip_users')) return { id: base.userId, status: 'ACTIVE' }
        if (sql.includes('FROM mip_growth_entries')) return null
        return { coin_balance: 3, version: 1 }
      },
      async query() { return { affectedRows: 1 } },
    }),
  })
  await assert.rejects(repository.recordGameCoinEvent({
    ...base,
    action: 'spendGameCoins',
    sourceEventType: 'game.reward_redeemed',
  }), /INSUFFICIENT_GAME_COIN_BALANCE/)
})

test('rejects client-like arbitrary event types instead of accepting an amount', async () => {
  const repository = createGameCoinRepository({ transaction: async () => { throw new Error('unexpected') } })
  await assert.rejects(repository.recordGameCoinEvent({
    ...base,
    sourceEventType: 'game.client_amount',
    amount: 999999,
  }), /GAME_COIN_RULE_NOT_AVAILABLE/)
})
