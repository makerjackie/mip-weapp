'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const {
  createTalentCursor,
  createTalentKey,
  readTalentCursor,
} = require('../lib/talent-cursor')

const secret = 'talent-cursor-test-secret-with-at-least-thirty-two-characters'
const userId = '40000000-0000-4000-8000-000000000002'
const payload = {
  snapshotAt: '2026-08-25T08:00:00.000Z',
  createdAt: '2026-06-24T08:00:00.000Z',
  userId,
}
const context = {
  appId: 'wx-cooperation-app',
  viewerId: '40000000-0000-4000-8000-000000000003',
  keyword: '品牌',
  branchId: '10000000-0000-4000-8000-000000000001',
  roleKey: 'strategist',
  industryTagIds: [
    '20000000-0000-4000-8000-000000000002',
    '20000000-0000-4000-8000-000000000001',
  ],
}

test('talent cursor encrypts the user key and authenticates the full query context', () => {
  const cursor = createTalentCursor(context, payload, secret)
  assert.match(cursor, /^mct1\./)
  assert.equal(cursor.includes(userId), false)
  assert.equal(Buffer.from(cursor.split('.')[2], 'base64url').toString('utf8').includes(userId), false)
  assert.deepEqual(readTalentCursor(cursor, {
    ...context,
    industryTagIds: [...context.industryTagIds].reverse(),
  }, secret), payload)
})

test('talent cursor rejects tampering and cross-app or cross-filter replay', () => {
  const cursor = createTalentCursor(context, payload, secret)
  const parts = cursor.split('.')
  const replacement = parts[2].endsWith('A') ? 'B' : 'A'
  const tampered = [parts[0], parts[1], `${parts[2].slice(0, -1)}${replacement}`, parts[3]].join('.')
  assert.throws(() => readTalentCursor(tampered, context, secret), /VALIDATION_FAILED/)
  assert.throws(() => readTalentCursor(cursor, { ...context, appId: 'wx-other-app' }, secret), /VALIDATION_FAILED/)
  assert.throws(() => readTalentCursor(cursor, { ...context, viewerId: userId }, secret), /VALIDATION_FAILED/)
  assert.throws(() => readTalentCursor(cursor, { ...context, keyword: '产品' }, secret), /VALIDATION_FAILED/)
  assert.throws(() => readTalentCursor(cursor, { ...context, roleKey: 'connector' }, secret), /VALIDATION_FAILED/)
  assert.throws(() => readTalentCursor(cursor, { ...context, industryTagIds: [] }, secret), /VALIDATION_FAILED/)
})

test('talent key is stable, app-scoped, and irreversible', () => {
  const first = createTalentKey({ appId: context.appId, userId }, secret)
  const repeated = createTalentKey({ appId: context.appId, userId }, secret)
  const otherApp = createTalentKey({ appId: 'wx-other-app', userId }, secret)
  assert.equal(first, repeated)
  assert.notEqual(first, otherApp)
  assert.match(first, /^mctk1\.[A-Za-z0-9_-]{43}$/)
  assert.equal(first.includes(userId), false)
})
