'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const { createOutboxService } = require('../domain/service')

const event = {
  id: '90000000-0000-4000-8000-000000000001',
  app_id: 'wx-app',
  attempts: 1,
}

describe('outbox service', () => {
  it('publishes deterministic idempotent projections before completing the event', async () => {
    const order = []
    const message = { dedupeKey: `outbox:${event.id}:checked-in` }
    const growth = { sourceEventId: event.id, sourceEventType: 'event.checked_in' }
    const service = createOutboxService({
      repository: {
        leaseBatch: async () => ({ events: [event], reaped: [] }),
        completeEvent: async () => {
          order.push('complete')
          return { eventId: event.id, status: 'DELIVERED' }
        },
      },
      projectEvent: async () => ({
        supported: true,
        notifications: [message],
        growth: [growth],
        reason: 'PROJECTED',
      }),
      clients: {
        publishMessage: async (_appId, value) => order.push(`notify:${value.dedupeKey}`),
        recordConfirmedEvent: async (_appId, value) => order.push(`growth:${value.sourceEventId}`),
      },
    })
    const result = await service.runBatch({ appId: 'wx-app', limit: 1 })
    assert.deepEqual(order, [
      `notify:${message.dedupeKey}`,
      `growth:${event.id}`,
      'complete',
    ])
    assert.equal(result.delivered, 1)
  })

  it('retries a transient target failure and never marks the event delivered', async () => {
    let completed = false
    const service = createOutboxService({
      repository: {
        leaseBatch: async () => ({ events: [event], reaped: [] }),
        completeEvent: async () => {
          completed = true
        },
        retryEvent: async (_event, code) => ({ eventId: event.id, status: 'RETRY', errorCode: code }),
      },
      projectEvent: async () => ({ supported: true, notifications: [{}], growth: [] }),
      clients: {
        publishMessage: async () => {
          throw new Error('INTERNAL_FUNCTION_FAILED')
        },
      },
    })
    const result = await service.runBatch({ appId: 'wx-app' })
    assert.equal(result.retried, 1)
    assert.equal(completed, false)
  })

  it('replays deterministic recipient messages after a partial delivery failure', async () => {
    const messages = [
      { dedupeKey: `outbox:${event.id}:recipient:one` },
      { dedupeKey: `outbox:${event.id}:recipient:two` },
    ]
    let run = 0
    let failedOnce = false
    let completed = 0
    let retried = 0
    const published = []
    const service = createOutboxService({
      repository: {
        async leaseBatch() {
          run += 1
          return { events: [{ ...event, attempts: run }], reaped: [] }
        },
        async completeEvent() {
          completed += 1
          return { eventId: event.id, status: 'DELIVERED' }
        },
        async retryEvent(_event, code) {
          retried += 1
          return { eventId: event.id, status: 'RETRY', errorCode: code }
        },
      },
      projectEvent: async () => ({
        supported: true,
        notifications: messages,
        growth: [],
        reason: 'PROJECTED',
      }),
      clients: {
        async publishMessage(_appId, message) {
          published.push(message.dedupeKey)
          if (message === messages[1] && !failedOnce) {
            failedOnce = true
            throw new Error('INTERNAL_FUNCTION_FAILED')
          }
        },
      },
    })

    const first = await service.runBatch({ appId: 'wx-app' })
    const second = await service.runBatch({ appId: 'wx-app' })
    assert.equal(first.retried, 1)
    assert.equal(second.delivered, 1)
    assert.equal(retried, 1)
    assert.equal(completed, 1)
    assert.deepEqual(published, [
      messages[0].dedupeKey,
      messages[1].dedupeKey,
      messages[0].dedupeKey,
      messages[1].dedupeKey,
    ])
  })

  it('cancels an unknown event through the auditable unsupported path', async () => {
    let ignored = false
    const service = createOutboxService({
      repository: {
        leaseBatch: async () => ({ events: [event], reaped: [] }),
        ignoreEvent: async () => {
          ignored = true
          return { eventId: event.id, status: 'IGNORED' }
        },
      },
      projectEvent: async () => ({ supported: false, notifications: [], growth: [] }),
      clients: {},
    })
    const result = await service.runBatch({ appId: 'wx-app' })
    assert.equal(ignored, true)
    assert.equal(result.ignored, 1)
  })
})
