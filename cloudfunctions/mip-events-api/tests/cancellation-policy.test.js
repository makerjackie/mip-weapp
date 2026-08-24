'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const {
  effectiveCancellationDeadline,
  eventCancellationHours,
} = require('../domain/event-service')

describe('event cancellation policy', () => {
  it('normalizes a bounded platform default and fails closed to 24 hours', () => {
    assert.equal(eventCancellationHours('{"cancellationHoursBeforeStart":12}'), 12)
    assert.equal(eventCancellationHours({ cancellationHoursBeforeStart: 0 }), 0)
    assert.equal(eventCancellationHours({ cancellationHoursBeforeStart: 721 }), 24)
    assert.equal(eventCancellationHours('{invalid'), 24)
  })

  it('prefers an event override and otherwise derives the app-scoped deadline', async () => {
    const override = await effectiveCancellationDeadline({
      one: async () => { throw new Error('setting must not be read') },
    }, 'wx-app', {
      starts_at: '2026-09-02T10:00:00.000Z',
      cancellation_deadline: '2026-09-01T20:00:00.000Z',
    })
    assert.equal(override.toISOString(), '2026-09-01T20:00:00.000Z')

    const calls = []
    const derived = await effectiveCancellationDeadline({
      async one(sql, params) {
        calls.push({ sql, params })
        return { value_json: '{"cancellationHoursBeforeStart":18}' }
      },
    }, 'wx-app', {
      starts_at: '2026-09-02T10:00:00.000Z',
      cancellation_deadline: null,
    })
    assert.equal(derived.toISOString(), '2026-09-01T16:00:00.000Z')
    assert.match(calls[0].sql, /mip_app_settings/)
    assert.deepEqual(calls[0].params, ['wx-app'])
  })
})
