'use strict'

const assert = require('node:assert/strict')
const { it } = require('node:test')
const { createCommerceRepository } = require('../domain/repository')
const { createCommerceService } = require('../domain/service')

const caller = { appId: 'audit-app', identityKey: 'current-user' }
const createdAt = new Date('2026-09-12T00:00:00.123Z')
const rows = Array.from({ length: 31 }, (_, index) => ({
  id: `10000000-0000-4000-8000-${String(31 - index).padStart(12, '0')}`,
  created_at: createdAt, order_type: 'CONTENT', amount_cents: 100, currency: 'CNY',
  status: 'PAID', service_status: index === 30 ? 'PENDING_USE' : 'COMPLETED', version: 1,
}))

function fixture(sourceRows = rows) {
  const queries = []
  const repository = createCommerceRepository({
    async query(sql, params) {
      queries.push({ sql, params })
      assert.match(sql, /i.identity_key = \?/)
      assert.match(sql, /WHERE o.app_id = \?/)
      assert.deepEqual(params.slice(0, 2), [caller.identityKey, caller.appId])
      assert.match(sql, /o.status NOT IN \('CREATED', 'PAYMENT_CREATED'\)/)
      let result = sourceRows.filter(row => !['CREATED', 'PAYMENT_CREATED'].includes(row.status))
      const filtered = sql.includes('END) = ?')
      if (filtered) result = result.filter(row => row.service_status === params[2])
      if (sql.includes('o.created_at < ?')) {
        const offset = filtered ? 3 : 2
        assert.equal(params[offset].getTime(), createdAt.getTime())
        assert.equal(params[offset + 1].getTime(), createdAt.getTime())
        result = result.filter(row => row.id < params[offset + 2])
      }
      return result.slice(0, Number(/LIMIT (\d+)/.exec(sql)[1]))
    },
  })
  return { service: createCommerceService({ repository }), queries }
}

it('pages beyond 30 orders sharing a timestamp without duplicates and retains the legacy array', async () => {
  const { service, queries } = fixture()
  const first = await service.listOrderPage(caller, {})
  assert.equal(first.items.length, 30)
  assert.ok(first.nextCursor)
  const second = await service.listOrderPage(caller, { cursor: first.nextCursor })
  assert.deepEqual(second.items.map(row => row.id), [rows[30].id])
  assert.equal(second.nextCursor, undefined)
  assert.match(queries[1].sql, /ORDER BY o.created_at DESC, o.id DESC/)
  assert.equal((await service.listOrders(caller, {})).length, 30)
})

it('filters server service status before pagination, exposing an older pending order on page one', async () => {
  const { service, queries } = fixture()
  const page = await service.listOrderPage(caller, { serviceStatus: 'PENDING_USE' })
  assert.deepEqual(page.items.map(row => row.id), [rows[30].id])
  assert.ok(queries[0].sql.indexOf('END) = ?') < queries[0].sql.indexOf('LIMIT'))
  assert.equal(page.nextCursor, undefined)
})

it('rejects malformed cursors and filters before querying', () => {
  const { service, queries } = fixture()
  for (const cursor of ['bad-json', 'x'.repeat(257), Buffer.from(JSON.stringify({ createdAt: '2026-02-30T00:00:00.000Z', id: rows[0].id })).toString('base64url')]) {
    assert.throws(() => service.listOrderPage(caller, { cursor }), /VALIDATION_FAILED/)
  }
  assert.throws(() => service.listOrderPage(caller, { serviceStatus: 'PAID' }), /VALIDATION_FAILED/)
  assert.equal(queries.length, 0)
})

it('hides unpaid orders before pagination while retaining paid and refund history', async () => {
  const pending = ['CREATED', 'PAYMENT_CREATED'].map((status, index) => ({ ...rows[0], id: `pending-${index}`, status }))
  const history = ['PAID', 'REFUND_PENDING', 'REFUNDED'].map((status, index) => ({ ...rows[index], status }))
  const { service } = fixture([...pending, ...history])
  assert.deepEqual((await service.listOrderPage(caller, {})).items.map(row => row.status), history.map(row => row.status))
  assert.deepEqual((await service.listOrders(caller, {})).map(row => row.status), history.map(row => row.status))
})
