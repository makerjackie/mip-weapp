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

  it('enqueues a cursor continuation before completing a recipient page', async () => {
    const order = []
    const continuation = { knowledgeRecipientCursor: '20000000-0000-4000-8000-000000000500' }
    const service = createOutboxService({
      repository: {
        leaseBatch: async () => ({ events: [event], reaped: [] }),
        enqueueContinuation: async (_event, value) => order.push(`continue:${value.knowledgeRecipientCursor}`),
        completeEvent: async () => {
          order.push('complete')
          return { eventId: event.id, status: 'DELIVERED' }
        },
      },
      projectEvent: async () => ({
        supported: true, notifications: [], growth: [], reason: 'PROJECTED', continuation,
      }),
      clients: {},
    })
    const result = await service.runBatch({ appId: 'wx-app', limit: 1 })
    assert.deepEqual(order, [`continue:${continuation.knowledgeRecipientCursor}`, 'complete'])
    assert.equal(result.results[0].continuation, true)
  })

  it('keeps a bounded drain active until the queued cursor continuation is processed', async () => {
    const queue = [event]
    const completed = []
    const repository = {
      async leaseBatch() {
        const next = queue.shift()
        return { events: next ? [next] : [], reaped: [] }
      },
      async enqueueContinuation(parent, payload) {
        queue.push({ ...parent, id: '90000000-0000-4000-8000-000000000002', payload_json: JSON.stringify(payload) })
      },
      async completeEvent(value) {
        completed.push(value.id)
        return { eventId: value.id, status: 'DELIVERED' }
      },
    }
    const service = createOutboxService({
      repository,
      projectEvent: async value => ({
        supported: true,
        notifications: [],
        growth: [],
        reason: 'PROJECTED',
        continuation: value.payload_json
          ? null
          : { knowledgeRecipientCursor: '20000000-0000-4000-8000-000000000050' },
      }),
      clients: {},
    })
    const result = await service.runBatch({ appId: 'wx-app', limit: 5, drain: true, maxBatches: 5 })
    assert.deepEqual(completed, [event.id, '90000000-0000-4000-8000-000000000002'])
    assert.equal(result.delivered, 2)
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

  it('completes the durable outbox fact before best-effort external notification delivery', async () => {
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
          return { delivered: 1, failed: 0, pending: 0, terminal: 0 }
        },
      },
    })

    const result = await service.runBatch({ appId: 'wx-app', drain: true, limit: 1, maxBatches: 2 })
    assert.equal(result.batches, 2)
    assert.equal(result.delivered, 1)
    assert.deepEqual(order, ['publish', 'complete', 'deliver'])
    assert.deepEqual(result.results[0].externalDelivery, {
      requested: true,
      status: 'COMPLETED',
      deliveredCount: 1,
      pendingCount: 0,
      terminalCount: 0,
    })
    assert.deepEqual(result.externalDelivery, {
      requestedEvents: 1,
      completedEvents: 1,
      pendingEvents: 0,
      terminalEvents: 0,
      wakeFailedEvents: 0,
      deliveredCount: 1,
      pendingCount: 0,
      terminalCount: 0,
    })
  })

  it('does not retry a completed outbox fact while the external task remains pending', async () => {
    let completed = false
    let retried = false
    const service = createOutboxService({
      repository: {
        async leaseBatch() { return { events: [event], reaped: [] } },
        async completeEvent() {
          completed = true
          return { eventId: event.id, status: 'DELIVERED' }
        },
        async retryEvent() { retried = true },
      },
      projectEvent: async () => ({
        supported: true,
        notifications: [{ external: { channel: 'WECHAT_SUBSCRIPTION' } }],
        growth: [],
      }),
      clients: {
        async publishMessage() {},
        async runNotificationBatch() {
          return { delivered: 0, failed: 1, pending: 1, terminal: 0 }
        },
      },
    })

    const result = await service.runBatch({ appId: 'wx-app' })
    assert.equal(result.delivered, 1)
    assert.equal(result.retried, 0)
    assert.equal(completed, true)
    assert.equal(retried, false)
    assert.deepEqual(result.results[0].externalDelivery, {
      requested: true,
      status: 'PENDING',
      deliveredCount: 0,
      pendingCount: 1,
      terminalCount: 0,
    })
  })

  it('does not cancel a completed outbox fact for a terminal external task', async () => {
    let completed = false
    let dead = false
    const service = createOutboxService({
      repository: {
        async leaseBatch() { return { events: [event], reaped: [] } },
        async completeEvent() {
          completed = true
          return { eventId: event.id, status: 'DELIVERED' }
        },
        async deadEvent() { dead = true },
      },
      projectEvent: async () => ({
        supported: true,
        notifications: [{ external: { channel: 'WECHAT_SUBSCRIPTION' } }],
        growth: [],
      }),
      clients: {
        async publishMessage() {},
        async runNotificationBatch() {
          return { delivered: 0, failed: 0, pending: 0, terminal: 1 }
        },
      },
    })

    const result = await service.runBatch({ appId: 'wx-app' })
    assert.equal(result.delivered, 1)
    assert.equal(result.dead, 0)
    assert.equal(completed, true)
    assert.equal(dead, false)
    assert.deepEqual(result.results[0].externalDelivery, {
      requested: true,
      status: 'TERMINAL',
      deliveredCount: 0,
      pendingCount: 0,
      terminalCount: 1,
    })
  })

  it('contains external wake failures after completing the durable outbox fact', async () => {
    let completed = false
    let retried = false
    const service = createOutboxService({
      repository: {
        async leaseBatch() { return { events: [event], reaped: [] } },
        async completeEvent() {
          completed = true
          return { eventId: event.id, status: 'DELIVERED' }
        },
        async retryEvent() { retried = true },
      },
      projectEvent: async () => ({
        supported: true,
        notifications: [{ external: { channel: 'WECHAT_SUBSCRIPTION' } }],
        growth: [],
      }),
      clients: {
        async publishMessage() {},
        async runNotificationBatch() { throw new Error('PROVIDER_SECRET_MUST_NOT_LEAK') },
      },
    })

    const result = await service.runBatch({ appId: 'wx-app' })
    assert.equal(result.delivered, 1)
    assert.equal(completed, true)
    assert.equal(retried, false)
    assert.deepEqual(result.results[0].externalDelivery, {
      requested: true,
      status: 'WAKE_FAILED',
      deliveredCount: 0,
      pendingCount: 0,
      terminalCount: 0,
    })
    assert.equal(JSON.stringify(result).includes('PROVIDER_SECRET_MUST_NOT_LEAK'), false)
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
