'use strict'

const assert = require('node:assert/strict')
const { test } = require('node:test')
const { createGrowthOperationsRepository } = require('../domain/repositories/growth-operations')

function reversalFixture(balance = 300) {
  const state = { balance, version: 1, reversals: [], entries: [], audits: [], outbox: [], totalsRead: [] }
  let accountLock = Promise.resolve()
  let nextId = 0
  const database = {
    async transaction(work) {
      // Model an RR snapshot established before a competing administrator commits.
      const snapshotTotal = state.reversals.reduce((sum, value) => sum + value, 0)
      let releaseLock
      let lockHeld = false
      const pending = { entries: [], reversals: [], audits: [], outbox: [] }
      const tx = {
        pending,
        async one(sql, params) {
          if (sql.includes('FROM mip_growth_entries')) {
            assert.match(sql, /FOR SHARE$/)
            assert.deepEqual(params, ['app-a', 'original-entry'])
            return { id: 'original-entry', user_id: 'member-a', delta_value: 100 }
          }
          if (sql.includes('FROM mip_growth_accounts')) {
            assert.match(sql, /FOR UPDATE$/)
            assert.deepEqual(params, ['app-a', 'member-a'])
            const preceding = accountLock
            accountLock = new Promise(resolve => { releaseLock = resolve })
            await preceding
            lockHeld = true
            return { contribution_balance: state.balance, version: state.version }
          }
          if (sql.includes('FROM mip_contribution_reversals')) {
            assert.equal(lockHeld, true, 'serialize account before checking the original reversal limit')
            assert.deepEqual(params, ['app-a', 'original-entry'])
            const total = /FOR SHARE$/.test(sql)
              ? state.reversals.reduce((sum, value) => sum + value, 0)
              : snapshotTotal
            state.totalsRead.push(total)
            return { total }
          }
          assert.fail(`Unexpected read: ${sql}`)
        },
        async query(sql, params) {
          assert.equal(lockHeld, true)
          if (sql.startsWith('UPDATE mip_growth_accounts')) pending.balance = params[0]
          else if (sql.startsWith('INSERT INTO mip_growth_entries')) pending.entries.push(params)
          else if (sql.startsWith('INSERT INTO mip_contribution_reversals')) pending.reversals.push(params[3])
          else assert.fail(`Unexpected write: ${sql}`)
          return { affectedRows: 1 }
        },
      }
      try {
        const result = await work(tx)
        state.balance = pending.balance
        state.version += 1
        for (const key of ['entries', 'reversals', 'audits', 'outbox']) state[key].push(...pending[key])
        return result
      }
      finally { releaseLock?.() }
    },
  }
  const repository = createGrowthOperationsRepository(database, {
    id: () => `id-${++nextId}`,
    lockMutation: async () => ({ scopeType: 'PLATFORM', scopeId: null }),
    assertScope: () => {},
    writeAudit: async (tx, value) => { tx.pending.audits.push(value) },
    writeOutbox: async (tx, value) => { tx.pending.outbox.push(value) },
  })
  return {
    state,
    reverse: (actorUserId, reversalValue) => repository.reverseContribution({
      appId: 'app-a', actorUserId, originalTransactionNo: 'original-entry', reversalValue,
      reason: '纠正重复发放', audit: id => ({ resourceId: id, actorUserId }),
    }),
  }
}

test('concurrent administrators cannot reverse more than one original despite sufficient account balance', async () => {
  const fixture = reversalFixture()
  const results = await Promise.allSettled([
    fixture.reverse('admin-a', 70), fixture.reverse('admin-b', 70),
  ])
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1)
  assert.equal(results.find(result => result.status === 'rejected').reason.code, 'REVERSAL_EXCEEDS_ORIGINAL')
  assert.deepEqual(fixture.state.totalsRead, [0, 70], 'waiting reversal must read committed totals, not its older snapshot')
  assert.equal(fixture.state.balance, 230)
  assert.deepEqual(fixture.state.reversals, [70])
  assert.equal(fixture.state.entries.length, 1)
  assert.equal(fixture.state.audits.length, 1)
  assert.equal(fixture.state.outbox.length, 1)

  const remainder = await fixture.reverse('admin-b', 30)
  assert.equal(remainder.balanceAfter, 200)
  assert.deepEqual(fixture.state.reversals, [70, 30])
})

test('insufficient contribution balance adds no reversal, ledger, audit or outbox record', async () => {
  const fixture = reversalFixture(20)
  await assert.rejects(fixture.reverse('admin-a', 30), { code: 'INSUFFICIENT_BALANCE' })
  assert.equal(fixture.state.balance, 20)
  for (const key of ['reversals', 'entries', 'audits', 'outbox']) assert.equal(fixture.state[key].length, 0)
})
