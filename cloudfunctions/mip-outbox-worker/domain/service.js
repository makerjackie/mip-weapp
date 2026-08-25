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
        const projectedFollowUp = result.results.some(item => Number(item.growthEvents || 0) > 0 || item.continuation)
        const retryAt = earliestRetryAt(result.results)
        if (retryAt && input.drain === true && batch + 1 < maxBatches) {
          const delay = Math.max(0, retryAt - Number(clock()))
          if (Number(clock()) + delay >= deadline) break
          await wait(delay)
          continue
        }
        if (result.leased < limit && !projectedFollowUp) {
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
        externalDelivery: aggregateExternalDelivery(results),
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
      await publishNotifications(event.app_id, projected.notifications)
      for (const growth of projected.growth) {
        await clients.recordConfirmedEvent(event.app_id, growth)
      }
      if (projected.continuation) {
        await repository.enqueueContinuation(event, projected.continuation)
      }
      const completed = await repository.completeEvent(event)
      const externalDelivery = projected.notifications.some(notification => notification.external)
        ? await observeExternalDelivery(clients, event.app_id)
        : externalDeliverySummary('NOT_REQUESTED')
      return {
        ...completed,
        notifications: projected.notifications.length,
        growthEvents: projected.growth.length,
        continuation: Boolean(projected.continuation),
        projection: projected.reason,
        externalDelivery,
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

  async function publishNotifications(appId, notifications) {
    const concurrency = 5
    for (let index = 0; index < notifications.length; index += concurrency) {
      await Promise.all(notifications.slice(index, index + concurrency)
        .map(notification => clients.publishMessage(appId, notification)))
    }
  }
}

async function observeExternalDelivery(clients, appId) {
  try {
    return summarizeNotificationBatch(await clients.runNotificationBatch(appId, 20))
  }
  catch {
    return externalDeliverySummary('WAKE_FAILED')
  }
}

function summarizeNotificationBatch(result) {
  if (!result || typeof result !== 'object') return externalDeliverySummary('WAKE_FAILED')
  const deliveredCount = nonnegativeInteger(result.delivered)
  const failedCount = nonnegativeInteger(result.failed)
  const pendingCount = nonnegativeInteger(result.pending)
  const terminalCount = nonnegativeInteger(result.terminal)
  if ([deliveredCount, failedCount, pendingCount, terminalCount].some(value => value === null)) {
    return externalDeliverySummary('WAKE_FAILED')
  }
  const retryableCount = Math.max(failedCount, pendingCount)
  const status = terminalCount > 0
    ? 'TERMINAL'
    : retryableCount > 0
      ? 'PENDING'
      : 'COMPLETED'
  return externalDeliverySummary(status, {
    deliveredCount,
    pendingCount: retryableCount,
    terminalCount,
  })
}

function externalDeliverySummary(status, counts = {}) {
  return {
    requested: status !== 'NOT_REQUESTED',
    status,
    deliveredCount: counts.deliveredCount || 0,
    pendingCount: counts.pendingCount || 0,
    terminalCount: counts.terminalCount || 0,
  }
}

function aggregateExternalDelivery(results) {
  const summary = {
    requestedEvents: 0,
    completedEvents: 0,
    pendingEvents: 0,
    terminalEvents: 0,
    wakeFailedEvents: 0,
    deliveredCount: 0,
    pendingCount: 0,
    terminalCount: 0,
  }
  for (const result of results) {
    const external = result?.externalDelivery
    if (!external?.requested) continue
    summary.requestedEvents += 1
    if (external.status === 'COMPLETED') summary.completedEvents += 1
    if (external.status === 'PENDING') summary.pendingEvents += 1
    if (external.status === 'TERMINAL') summary.terminalEvents += 1
    if (external.status === 'WAKE_FAILED') summary.wakeFailedEvents += 1
    summary.deliveredCount += external.deliveredCount
    summary.pendingCount += external.pendingCount
    summary.terminalCount += external.terminalCount
  }
  return summary
}

function nonnegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null
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
  aggregateExternalDelivery,
  createOutboxService,
  earliestRetryAt,
  externalDeliverySummary,
  normalizeLimit,
  normalizeMaxBatches,
  observeExternalDelivery,
  safeError,
  summarizeNotificationBatch,
  terminalErrors,
}
