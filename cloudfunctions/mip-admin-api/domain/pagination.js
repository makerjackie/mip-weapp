'use strict'

const { AdminError } = require('./validation')

const MAX_CURSOR_LENGTH = 512

function encodeCursor(value) {
  return Buffer.from(JSON.stringify({ v: 1, ...value }), 'utf8').toString('base64url')
}

function decodeCursor(value, fields) {
  if (!value) return null
  if (typeof value !== 'string' || value.length > MAX_CURSOR_LENGTH) {
    throw new AdminError('VALIDATION_FAILED', '分页游标无效')
  }
  let parsed
  try {
    parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
  }
  catch {
    throw new AdminError('VALIDATION_FAILED', '分页游标无效')
  }
  if (!parsed || parsed.v !== 1 || fields.some(field => typeof parsed[field] !== 'string' || !parsed[field])) {
    throw new AdminError('VALIDATION_FAILED', '分页游标无效')
  }
  return parsed
}

function cursorPredicate(column, cursor) {
  if (!cursor) return { sql: '', params: [] }
  return {
    sql: ` AND (${column} < ? OR (${column} = ? AND id < ?))`,
    params: [cursor.value, cursor.value, cursor.id],
  }
}

function cursorPredicateFor(column, cursor, valueKey, idColumn) {
  if (!cursor) return { sql: '', params: [] }
  return {
    sql: ` AND (${column} < ? OR (${column} = ? AND ${idColumn || 'id'} < ?))`,
    params: [cursor[valueKey], cursor[valueKey], cursor.id],
  }
}

function pageRows(rows, pageLimit, cursorFields) {
  const hasMore = rows.length > pageLimit
  const items = hasMore ? rows.slice(0, pageLimit) : rows
  const last = items[items.length - 1]
  return {
    items,
    nextCursor: hasMore && last
      ? encodeCursor(cursorFields(last))
      : null,
  }
}

module.exports = { cursorPredicateFor, decodeCursor, encodeCursor, pageRows }
