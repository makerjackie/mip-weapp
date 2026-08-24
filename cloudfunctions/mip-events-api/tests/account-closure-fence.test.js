'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const { cancelRegistration } = require('../domain/event-service')

test('event mutations reject a closed caller before reading or writing event facts', async () => {
  const calls = []
  const tx = {
    async one(sql, params) {
      calls.push({ kind: 'one', sql, params })
      if (sql.includes('FROM mip_users')) {
        return { id: params[1], status: 'CLOSED' }
      }
      throw new Error(`unexpected one: ${sql}`)
    },
    async query(sql, params) {
      calls.push({ kind: 'query', sql, params })
      throw new Error(`unexpected query: ${sql}`)
    },
  }
  const database = { transaction: work => work(tx) }

  await assert.rejects(
    cancelRegistration(database, {
      appId: 'wx-app',
      userId: '10000000-0000-4000-8000-000000000001',
      eventId: '20000000-0000-4000-8000-000000000001',
      expectedVersion: 1,
    }),
    error => error && error.code === 'FORBIDDEN',
  )

  assert.equal(calls.length, 1)
  assert.match(calls[0].sql, /FROM mip_users/)
  assert.match(calls[0].sql, /FOR UPDATE/)
  assert.equal(calls.some(call => call.kind === 'query'), false)
})
