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

  it('drains bounded batches and invokes external notification delivery before completing', async () => {
    let leased = 0
    const order = []
    const service = createOutboxService({
      repository: {
        async leaseBatch() {
          leased += 1
          return leased === 1
            ? { events: [event], reaped: [] }
            : { events: [], reaped: [] }
        },
        async completeEvent(value) {
          order.push('complete')
          return { eventId: value.id, status: 'DELIVERED' }
        },
      },
      projectEvent: async () => ({
        supported: true,
        notifications: [{ dedupeKey: 'external', external: { channel: 'WECHAT_SUBSCRIPTION' } }],
        growth: [],
        reason: 'PROJECTED',
      }),
      clients: {
        async publishMessage() { order.push('publish') },
        async runNotificationBatch() {
          order.push('deliver')
          return { failed: 0, pending: 0, terminal: 0 }
        },
      },
    })

    const result = await service.runBatch({ appId: 'wx-app', drain: true, limit: 1, maxBatches: 2 })
    assert.equal(result.batches, 2)
    assert.equal(result.delivered, 1)
    assert.deepEqual(order, ['publish', 'deliver', 'complete'])
  })

  it('does not complete while notification delivery remains pending', async () => {
    let completed = false
    const service = createOutboxService({
      repository: {
        async leaseBatch() { return { events: [event], reaped: [] } },
        async completeEvent() { completed = true },
        async retryEvent(_event, code) {
          return {
            eventId: event.id,
            status: 'RETRY',
            errorCode: code,
            nextAttemptAt: '2026-08-24T01:00:00.250Z',
          }
        },
      },
      projectEvent: async () => ({
        supported: true,
        notifications: [{ external: { channel: 'WECHAT_SUBSCRIPTION' } }],
        growth: [],
      }),
      clients: {
        async publishMessage() {},
        async runNotificationBatch() { return { failed: 1, pending: 1, terminal: 0 } },
      },
    })

    const result = await service.runBatch({ appId: 'wx-app' })
    assert.equal(result.retried, 1)
    assert.equal(completed, false)
    assert.equal(result.results[0].errorCode, 'NOTIFICATION_DELIVERY_PENDING')
  })

  it('moves a terminal notification failure to the outbox dead state', async () => {
    let completed = false
    let deadCode
    const service = createOutboxService({
      repository: {
        async leaseBatch() { return { events: [event], reaped: [] } },
        async completeEvent() { completed = true },
        async deadEvent(_event, code) {
          deadCode = code
          return { eventId: event.id, status: 'DEAD', errorCode: code }
        },
      },
      projectEvent: async () => ({
        supported: true,
        notifications: [{ external: { channel: 'WECHAT_SUBSCRIPTION' } }],
        growth: [],
      }),
      clients: {
        async publishMessage() {},
        async runNotificationBatch() { return { failed: 0, pending: 0, terminal: 1 } },
      },
    })

    const result = await service.runBatch({ appId: 'wx-app' })
    assert.equal(result.dead, 1)
    assert.equal(completed, false)
    assert.equal(deadCode, 'NOTIFICATION_DELIVERY_TERMINAL')
  })

  it('retries an internal target failure and completes within the same wake', async () => {
    let currentTime = new Date('2026-08-24T01:00:00.000Z').getTime()
    let attempt = 0
    let completed = 0
    let eligibleAt = currentTime
    const waits = []
    const service = createOutboxService({
      repository: {
        async leaseBatch() {
          if (currentTime < eligibleAt || attempt >= 2) return { events: [], reaped: [] }
          attempt += 1
          return { events: [{ ...event, attempts: attempt }], reaped: [] }
        },
        async completeEvent() {
          completed += 1
          return { eventId: event.id, status: 'DELIVERED' }
        },
        async retryEvent(_event, code) {
          eligibleAt = currentTime + 250
          return {
            eventId: event.id,
            status: 'RETRY',
            errorCode: code,
            nextAttemptAt: new Date(eligibleAt).toISOString(),
          }
        },
      },
      projectEvent: async () => ({ supported: true, notifications: [{}], growth: [] }),
      clients: {
        async publishMessage() {
          if (attempt === 1) throw new Error('INTERNAL_FUNCTION_FAILED')
        },
      },
      clock: () => currentTime,
      now: () => new Date(currentTime),
      async wait(delay) {
        waits.push(delay)
        currentTime += delay
      },
    })

    const result = await service.runBatch({
      appId: 'wx-app', drain: true, limit: 1, maxBatches: 3,
    })
    assert.deepEqual(waits, [250])
    assert.equal(result.retried, 1)
    assert.equal(result.delivered, 1)
    assert.equal(completed, 1)
  })

  it('continues draining when a projected growth write creates a follow-up outbox event', async () => {
    const followUp = { ...event, id: '90000000-0000-4000-8000-000000000002' }
    let leases = 0
    const service = createOutboxService({
      repository: {
        async leaseBatch() {
          leases += 1
          if (leases === 1) return { events: [event], reaped: [] }
          if (leases === 2) return { events: [followUp], reaped: [] }
          return { events: [], reaped: [] }
        },
        async completeEvent(value) {
          return { eventId: value.id, status: 'DELIVERED' }
        },
      },
      projectEvent: async value => value.id === event.id
        ? { supported: true, notifications: [], growth: [{}], reason: 'PROJECTED' }
        : { supported: true, notifications: [{}], growth: [], reason: 'PROJECTED' },
      clients: {
        async recordConfirmedEvent() {},
        async publishMessage() {},
      },
    })

    const result = await service.runBatch({ appId: 'wx-app', drain: true, limit: 10, maxBatches: 3 })
    assert.equal(result.batches, 2)
    assert.equal(result.delivered, 2)
  })
})
