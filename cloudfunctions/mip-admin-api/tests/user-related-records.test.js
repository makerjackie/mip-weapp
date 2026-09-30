'use strict'
const assert = require('node:assert/strict')
const { test } = require('node:test')
const { createUserRelatedRecordsRepository } = require('../domain/repositories/user-related-records')

test('paginates a nonempty user collection and rejects a cursor from another user or collection', async () => {
  const calls = []
  const rows = Array.from({ length: 21 }, (_, index) => ({ id: `case-${index}`, title: `案例 ${index}`, status: 'PUBLISHED', updated_at: new Date('2026-09-29T00:00:00Z') }))
  const repository = createUserRelatedRecordsRepository({ query: async (sql, params) => { calls.push({ sql, params }); return calls.length === 1 ? rows : rows.slice(20) } })
  const page = await repository.getUserRelatedPage('app', 'user-a', 'superCases', 20)
  assert.equal(page.superCases.length, 20)
  assert.ok(page.nextCursor)
  const next = await repository.getUserRelatedPage('app', 'user-a', 'superCases', 20, page.nextCursor)
  assert.equal(next.superCases[0].id, 'case-20')
  assert.match(calls[1].sql, /COALESCE\(CAST\(x.started_on AS DATETIME\), '1000-01-01 00:00:00'\) < \?/)
  assert.equal(calls[1].params.at(-1), 21)
  await assert.rejects(repository.getUserRelatedPage('app', 'user-b', 'superCases', 20, page.nextCursor), /分页范围已变化/)
  await assert.rejects(repository.getUserRelatedPage('app', 'user-a', 'opportunities', 20, page.nextCursor), /分页范围已变化/)
  assert.equal(calls.length, 2)
})

test('applies financial visibility in SQL before paging and invalidates a cursor after grants change', async () => {
  const calls = []
  const repository = createUserRelatedRecordsRepository({ query: async (sql, params) => {
    calls.push({ sql, params }); return Array.from({ length: 2 }, (_, index) => ({ id: `order-${index}`, status: 'PAID', order_type: 'EVENT', updated_at: new Date() }))
  } })
  const scope = { platform: false, branchIds: ['branch-a'], eventIds: [] }
  const page = await repository.getUserRelatedPage('app', 'user-a', 'orders', 1, null, scope)
  assert.match(calls[0].sql, /x.order_type = 'EVENT' AND \(e.branch_id IN \(\?\)\)/)
  assert.deepEqual(calls[0].params, ['app', 'user-a', 'branch-a', 2])
  await assert.rejects(repository.getUserRelatedPage('app', 'user-a', 'orders', 1, page.nextCursor, { ...scope, branchIds: ['branch-b'] }), /分页范围已变化/)
  assert.equal(calls.length, 1)
})
