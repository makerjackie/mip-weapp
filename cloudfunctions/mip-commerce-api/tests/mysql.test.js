'use strict'

const assert = require('node:assert/strict')
const { test } = require('node:test')
const { createMysqlDatabase } = require('../lib/mysql')

test('commerce MySQL adapter exposes the single-row health probe', async () => {
  const pool = {
    execute: async () => [[{ ok: 1 }]],
  }
  const database = createMysqlDatabase({ pool })

  assert.deepEqual(await database.one('SELECT 1 AS ok'), { ok: 1 })
})
