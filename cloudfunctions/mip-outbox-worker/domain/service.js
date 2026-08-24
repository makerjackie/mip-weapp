'use strict'

const terminalErrors = new Set([
  'INBOX_TARGET_INVALID',
  'NOTIFICATION_DELIVERY_TERMINAL',
  'OUTBOX_EVENT_INVALID',
  'VALIDATION_FAILED',
])

function createOutboxService(options) {
  const repository = options.repository
  const projectEvent = options.projectEvent
  const clients = options.clients
  const now = options.now || (() => new Date())
  const clock = options.clock || Date.now
  const wait = options.wait || (delay => new Promise(resolve => setTimeout(resolve, delay)))

  return {
    async runBatch(input) {
      const limit = normalizeLimit(input.limit)
      const maxBatches = input.drain === true ? normalizeMaxBatches(input.maxBatches) : 1
      const deadline = Number(clock()) + 45_000
      const batches = []
      for (let batch = 0; batch < maxBatches && Number(clock()) < deadline; batch += 1) {
        const result = await runSingleBatch(input.appId, limit)
        batches.push(result)
        const projectedGrowth = result.results.some(item => Number(item.growthEvents || 0) > 0)
        const retryAt = earliestRetryAt(result.results)
        if (retryAt && input.drain === true && batch + 1 < maxBatches) {
          const delay = Math.max(0, retryAt - Number(clock()))
          if (Number(clock()) + delay >= deadline) break
          await wait(delay)
          continue
        }
        if (result.leased < limit && !projectedGrowth) {
          break
        }
      }
      const results = batches.flatMap(batch => batch.results)
      return {
        batches: batches.length,
        leased: batches.reduce((total, batch) => total + batch.leased, 0),
        reaped: batches.reduce((total, batch) => total + batch.reaped, 0),
        delivered: results.filter(item => item.status === 'DELIVERED').length,
        retried: results.filter(item => item.status === 'RETRY').length,
        dead: results.filter(item => item.status === 'DEAD').length,
        ignored: results.filter(item => item.status === 'IGNORED').length,
        results,
      }
    },
  }

  async function runSingleBatch(appId, limit) {
    const leased = await repository.leaseBatch(appId, { limit, now: now() })
    const processed = await Promise.all(leased.events.map(processEvent))
    return {
      leased: leased.events.length,
      reaped: leased.reaped.length,
      results: [...leased.reaped, ...processed],
    }
  }

  async function processEvent(event) {
    try {
      const projected = await projectEvent(event)
      if (!projected.supported) {
        return repository.ignoreEvent(event)
      }
      for (const notification of projected.notifications) {
        await clients.publishMessage(event.app_id, notification)
      }
      for (const growth of projected.growth) {
        await clients.recordConfirmedEvent(event.app_id, growth)
      }
      if (projected.notifications.some(notification => notification.external)) {
        const delivery = await clients.runNotificationBatch(event.app_id, 20)
        assertNotificationBatch(delivery)
      }
      const completed = await repository.completeEvent(event)
      return {
        ...completed,
        notifications: projected.notifications.length,
        growthEvents: projected.growth.length,
        projection: projected.reason,
      }
    }
    catch (error) {
      const code = safeError(error)
      if (code === 'OUTBOX_LEASE_LOST') {
        return { eventId: event.id, status: 'LEASE_LOST', errorCode: code }
      }
      try {
        return terminalErrors.has(code)
          ? await repository.deadEvent(event, code)
          : await repository.retryEvent(event, code, now())
      }
      catch (leaseError) {
        const leaseCode = safeError(leaseError)
        if (leaseCode === 'OUTBOX_LEASE_LOST') {
          return { eventId: event.id, status: 'LEASE_LOST', errorCode: leaseCode }
        }
        throw leaseError
      }
    }
  }
}

function assertNotificationBatch(result) {
  if (!result || !Number.isInteger(result.failed)
    || !Number.isInteger(result.pending) || !Number.isInteger(result.terminal)) {
    throw new Error('INTERNAL_FUNCTION_FAILED')
  }
  if (result.terminal > 0) throw new Error('NOTIFICATION_DELIVERY_TERMINAL')
  if (result.failed > 0 || result.pending > 0) throw new Error('NOTIFICATION_DELIVERY_PENDING')
}

function earliestRetryAt(results) {
  const times = results
    .filter(item => item.status === 'RETRY')
    .map(item => new Date(item.nextAttemptAt).getTime())
    .filter(Number.isFinite)
  return times.length ? Math.min(...times) : 0
}

function normalizeLimit(value) {
  const limit = value === undefined ? 5 : Number(value)
  if (!Number.isInteger(limit) || limit < 1 || limit > 10) {
    throw new Error('VALIDATION_FAILED')
  }
  return limit
}

function normalizeMaxBatches(value) {
  const maxBatches = value === undefined ? 100 : Number(value)
  if (!Number.isInteger(maxBatches) || maxBatches < 1 || maxBatches > 100) {
    throw new Error('VALIDATION_FAILED')
  }
  return maxBatches
}

function safeError(error) {
  const code = error instanceof Error ? error.message : ''
  return /^[A-Z][A-Z0-9_]{2,63}$/.test(code) ? code : 'OUTBOX_DELIVERY_FAILED'
}

module.exports = {
  assertNotificationBatch,
  createOutboxService,
  earliestRetryAt,
  normalizeLimit,
  normalizeMaxBatches,
  safeError,
  terminalErrors,
}
