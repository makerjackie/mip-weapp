'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const { cursorPredicateFor, decodeCursor, encodeCursor, pageRows } = require('../domain/pagination')

describe('admin list pagination', () => {
  it('round-trips opaque cursor values and builds a stable descending predicate', () => {
    const encoded = encodeCursor({ updatedAt: '2026-08-24T10:00:00.000Z', id: 'user-2' })
    const cursor = decodeCursor(encoded, ['updatedAt', 'id'])
    assert.deepEqual(cursor.updatedAt, '2026-08-24T10:00:00.000Z')
    assert.deepEqual(cursor.id, 'user-2')
    assert.deepEqual(cursorPredicateFor('u.updated_at', cursor, 'updatedAt', 'u.id'), {
      sql: ' AND (u.updated_at < ? OR (u.updated_at = ? AND u.id < ?))',
      params: ['2026-08-24T10:00:00.000Z', '2026-08-24T10:00:00.000Z', 'user-2'],
    })
  })

  it('returns only the requested page and a cursor when another row exists', () => {
    const page = pageRows([
      { id: 'a', createdAt: '2026-08-24T10:00:00.000Z' },
      { id: 'b', createdAt: '2026-08-24T09:00:00.000Z' },
      { id: 'c', createdAt: '2026-08-24T08:00:00.000Z' },
    ], 2, row => ({ createdAt: row.createdAt, id: row.id }))
    assert.equal(page.items.length, 2)
    assert.equal(typeof page.nextCursor, 'string')
    const decoded = decodeCursor(page.nextCursor, ['createdAt', 'id'])
    assert.deepEqual(decoded, { v: 1, createdAt: '2026-08-24T09:00:00.000Z', id: 'b' })
  })

  it('rejects malformed cursors instead of widening the query', () => {
    assert.throws(() => decodeCursor('not-a-cursor', ['createdAt', 'id']), error => error.code === 'VALIDATION_FAILED')
    assert.throws(() => decodeCursor(encodeCursor({ createdAt: 'x' }), ['createdAt', 'id']), error => error.code === 'VALIDATION_FAILED')
  })
})
