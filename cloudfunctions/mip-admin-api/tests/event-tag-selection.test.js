'use strict'
const assert = require('node:assert/strict')
const { it } = require('node:test')
const { eventTagChange, applyEventTagChange } = require('../domain/event-tag-selection')
it('retains disabled historical selections while rejecting a newly selected disabled tag', async () => {
  const tx = { query: async sql => sql.includes('assignment.tag_id') ? [{ tag_id: 'old', tag_key: 'legacy' }] : [{ id: 'old', tag_key: 'legacy', status: 'INACTIVE' }] }
  assert.deepEqual(await eventTagChange(tx, { appId: 'app-a', eventId: 'event-a', tagIds: ['old'] }), { addedRows: [], removedRows: [] })
  await assert.rejects(() => eventTagChange({ query: async sql => sql.includes('assignment.tag_id') ? [] : [{ id: 'old', tag_key: 'legacy', status: 'INACTIVE' }] }, { appId: 'app-a', eventId: 'event-a', tagIds: ['old'] }), error => error.code === 'CONFLICT')
})
it('applies only the changed assignments and keeps the removed history tenant/event-scoped', async () => {
  const writes = []
  const tx = { query: async (sql, params) => {
    if (sql.includes('SELECT assignment')) return [{ tag_id: 'remove', tag_key: 'old' }, { tag_id: 'keep', tag_key: 'kept' }]
    if (sql.includes('SELECT id, tag_key')) return [{ id: 'keep', tag_key: 'kept', status: 'ACTIVE' }, { id: 'add', tag_key: 'new', status: 'ACTIVE' }]
    writes.push({ sql, params }); return { affectedRows: 1 }
  } }
  const input = { appId: 'app-a', eventId: 'event-a', actorUserId: 'actor-a', tagIds: ['keep', 'add'] }
  await applyEventTagChange(tx, input, await eventTagChange(tx, input))
  assert.equal(writes.length, 2)
  assert.match(writes[0].sql, /status = 'INACTIVE'/)
  assert.deepEqual(writes[0].params, ['actor-a', 'app-a', 'event-a', 'remove'])
  assert.deepEqual(writes[1].params, ['app-a', 'event-a', 'add', 'actor-a'])
})
