'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const { getFeedback, saveFeedback } = require('../domain/event-service')

const appId = 'wx-app'
const userId = '10000000-0000-4000-8000-000000000001'
const eventId = '20000000-0000-4000-8000-000000000001'
const feedbackId = '30000000-0000-4000-8000-000000000001'
const now = new Date('2026-08-25T00:00:00.000Z')

const accessPolicy = { requireAccess: async () => undefined }
const answers = {
  recommendation: 'RECOMMEND',
  roleKeys: ['connector', 'strategist'],
  joinIntent: 'JOIN_NOW',
  explorationMethods: ['ATTEND_EVENT'],
  rosterConsent: 'MATCH_OPPORTUNITIES',
}

function feedbackDatabase({ existing = null, updateAffectedRows = 1, insertError = null } = {}) {
  const calls = []
  let transactions = 0
  const tx = {
    async one(sql, params) {
      const normalized = String(sql).replace(/\s+/g, ' ').trim()
      calls.push({ kind: 'one', sql: normalized, params })
      if (normalized.includes('FROM mip_users')) return { id: userId, status: 'ACTIVE' }
      if (normalized.includes('FROM mip_event_registrations')) {
        return { id: 'registration-1', event_id: eventId, user_id: userId, status: 'ATTENDED', version: 3 }
      }
      if (normalized.includes('FROM mip_event_feedback')) return existing
      return null
    },
    async query(sql, params) {
      const normalized = String(sql).replace(/\s+/g, ' ').trim()
      calls.push({ kind: 'query', sql: normalized, params })
      if (normalized.includes('UPDATE mip_event_feedback')) {
        return { affectedRows: updateAffectedRows }
      }
      if (normalized.includes('INSERT INTO mip_event_feedback') && insertError) {
        throw insertError
      }
      return { affectedRows: 1 }
    },
  }
  return {
    calls,
    get transactions() { return transactions },
    one: tx.one,
    query: tx.query,
    transaction(work) {
      transactions += 1
      return work(tx)
    },
  }
}

function submit(database, expectedVersion) {
  return saveFeedback(database, {
    appId,
    userId,
    eventId,
    expectedVersion,
    draft: { rating: 5, body: '活动反馈', answers },
    participationAccessPolicy: accessPolicy,
    now,
  })
}

describe('event feedback optimistic version contract', () => {
  it('uses version zero for the first submission', async () => {
    const database = feedbackDatabase()
    const result = await submit(database, 0)

    assert.equal(result.version, 1)
    assert.deepEqual(result.answers, answers)
    const insert = database.calls.find(call => call.sql.includes('INSERT INTO mip_event_feedback'))
    assert.ok(insert)
    assert.match(insert.sql, /answers_json/)
    assert.equal(insert.params[6], JSON.stringify(answers))
  })

  it('stores an omitted optional body as an empty database value', async () => {
    const database = feedbackDatabase()
    const result = await saveFeedback(database, {
      appId,
      userId,
      eventId,
      expectedVersion: 0,
      draft: { rating: 4, answers },
      participationAccessPolicy: accessPolicy,
      now,
    })

    const insert = database.calls.find(call => call.sql.includes('INSERT INTO mip_event_feedback'))
    assert.equal(insert.params[5], '')
    assert.equal('body' in result, false)
    assert.equal(result.rating, 4)
  })

  it('uses the current positive version for updates', async () => {
    const database = feedbackDatabase({
      existing: { id: feedbackId, version: 2, submitted_at: '2026-08-24T00:00:00.000Z' },
    })
    const result = await submit(database, 2)

    assert.equal(result.version, 3)
    const update = database.calls.find(call => call.sql.includes('UPDATE mip_event_feedback'))
    assert.match(update.sql, /answers_json = \?/)
    assert.equal(update.params[2], JSON.stringify(answers))
    assert.deepEqual(update.params.slice(-3), [appId, feedbackId, 2])
  })

  it('rejects missing, malformed, and stale versions with a stable retryable conflict', async () => {
    for (const expectedVersion of [undefined, null, '0', -1, 1.5]) {
      const database = feedbackDatabase()
      await assert.rejects(
        submit(database, expectedVersion),
        error => error?.code === 'CONFLICT' && error?.retryable === true,
      )
      assert.equal(database.transactions, 0)
    }

    const stale = feedbackDatabase({
      existing: { id: feedbackId, version: 2, submitted_at: '2026-08-24T00:00:00.000Z' },
    })
    await assert.rejects(
      submit(stale, 1),
      error => error?.code === 'CONFLICT' && error?.retryable === true,
    )
    assert.equal(stale.calls.some(call => call.sql.includes('UPDATE mip_event_feedback')), false)
  })

  it('maps a lost conditional update to the same conflict contract', async () => {
    const database = feedbackDatabase({
      existing: { id: feedbackId, version: 2, submitted_at: '2026-08-24T00:00:00.000Z' },
      updateAffectedRows: 0,
    })
    await assert.rejects(
      submit(database, 2),
      error => error?.code === 'CONFLICT' && error?.retryable === true,
    )
  })

  it('maps a concurrent first insert to the same conflict contract', async () => {
    const database = feedbackDatabase({ insertError: { code: 'ER_DUP_ENTRY' } })
    await assert.rejects(
      submit(database, 0),
      error => error?.code === 'CONFLICT' && error?.retryable === true,
    )
  })

  it('returns structured answers and keeps legacy null answers explicit', async () => {
    for (const [answersJson, expectedAnswers] of [[JSON.stringify(answers), answers], [null, null]]) {
      const database = feedbackDatabase({
        existing: {
          id: feedbackId,
          rating: 5,
          body: '',
          answers_json: answersJson,
          version: 2,
          submitted_at: '2026-08-24T00:00:00.000Z',
          updated_at: '2026-08-24T00:00:00.000Z',
        },
      })
      const result = await getFeedback(database, { appId, eventId, userId })
      assert.deepEqual(result.answers, expectedAnswers)
      assert.equal('body' in result, false)
      assert.ok(database.calls.some(call => call.sql.includes('answers_json')))
    }
  })

  it('rejects incomplete answers before opening a transaction', async () => {
    const database = feedbackDatabase()
    await assert.rejects(
      saveFeedback(database, {
        appId,
        userId,
        eventId,
        expectedVersion: 0,
        draft: { rating: 5, answers: { ...answers, roleKeys: [] } },
        participationAccessPolicy: accessPolicy,
        now,
      }),
      error => error?.code === 'VALIDATION_FAILED',
    )
    assert.equal(database.transactions, 0)
  })
})
