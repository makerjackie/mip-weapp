'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const { draftRequestDisposition } = require('../domain/repository')
const { draftRequestHash } = require('../domain/service')

const now = Date.parse('2026-08-30T08:00:00.000Z')
const inputHash = 'a'.repeat(64)
const input = { kind: 'TEXT', inputHash }

function row(overrides = {}) {
  return {
    input_hash: inputHash,
    draft_kind: 'TEXT',
    status: 'PROCESSING',
    lease_expires_at: '2026-08-30T07:59:00.000Z',
    expires_at: '2026-08-31T08:00:00.000Z',
    ...overrides,
  }
}

test('classifies request replay, conflict, in-progress and expired-lease resume deterministically', () => {
  assert.equal(draftRequestDisposition(row(), input, null, now), 'RESUME')
  assert.equal(draftRequestDisposition(row({ lease_expires_at: '2026-08-30T08:01:00.000Z' }), input, null, now), 'IN_PROGRESS')
  assert.equal(draftRequestDisposition(row({ status: 'COMPLETED' }), input, null, now), 'REPLAY')
  assert.equal(draftRequestDisposition(row({ input_hash: 'b'.repeat(64) }), input, null, now), 'CONFLICT')
  assert.equal(draftRequestDisposition(row({ expires_at: '2026-08-30T07:59:00.000Z' }), input, null, now), 'EXPIRED')
})

test('requires the active lease to finish before a ready draft can be adopted', () => {
  assert.equal(draftRequestDisposition(
    row({ lease_expires_at: '2026-08-30T08:01:00.000Z' }),
    input,
    { status: 'DRAFT_READY' },
    now,
  ), 'IN_PROGRESS')
  assert.equal(draftRequestDisposition(
    row(),
    input,
    { status: 'DRAFT_READY' },
    now,
  ), 'RESUME_READY')
})

test('hashes the create kind and normalized business input but not request id', () => {
  const first = draftRequestHash('TEXT', {
    purpose: 'PROFILE',
    transcriptText: '资料',
    requestId: 'ai-draft:first',
  })
  const replay = draftRequestHash('TEXT', {
    purpose: 'PROFILE',
    transcriptText: '资料',
    requestId: 'ai-draft:second',
  })
  const changed = draftRequestHash('TEXT', {
    purpose: 'PROFILE',
    transcriptText: '不同资料',
    requestId: 'ai-draft:first',
  })
  assert.equal(first, replay)
  assert.notEqual(first, changed)
})
