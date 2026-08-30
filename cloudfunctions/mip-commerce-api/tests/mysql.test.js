'use strict'

const assert = require('node:assert/strict')
const { test } = require('node:test')
const { createMysqlDatabase } = require('../lib/mysql')

test('commerce MySQL adapter exposes the single-row health probe', async () => {
  const pool = {
    query: async () => [[{ ok: 1 }]],
  }
  const database = createMysqlDatabase({ pool })

  assert.deepEqual(await database.one('SELECT 1 AS ok'), { ok: 1 })
})

test('commerce MySQL adapter keeps bounded pagination parameters on the text protocol', async () => {
  const calls = []
  const pool = {
    query: async (sql, params) => {
      calls.push({ sql, params })
      return [[{ ok: 1 }]]
    },
  }
  const database = createMysqlDatabase({ pool })

  await database.query('SELECT 1 LIMIT ? OFFSET ?', [25, 0])

  assert.deepEqual(calls, [{ sql: 'SELECT 1 LIMIT ? OFFSET ?', params: [25, 0] }])
})

test('commerce MySQL adapter rejects formatter-expanded parameter types', async () => {
  const pool = {
    query: async () => [[{ ok: 1 }]],
  }
  const database = createMysqlDatabase({ pool })

  for (const value of [undefined, () => 'unsafe', Symbol('unsafe'), ['unsafe'], { unsafe: true }]) {
    await assert.rejects(
      () => database.query('SELECT ?', [value]),
      { name: 'TypeError', message: 'INVALID_SQL_PARAMETER' },
    )
  }
})
