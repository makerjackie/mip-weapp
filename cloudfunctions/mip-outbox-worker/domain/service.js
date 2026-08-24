'use strict'

const terminalErrors = new Set([
  'INBOX_TARGET_INVALID',
  'OUTBOX_EVENT_INVALID',
  'VALIDATION_FAILED',
])

function createOutboxService(options) {
  const repository = options.repository
  const projectEvent = options.projectEvent
  const clients = options.clients
  const now = options.now || (() => new Date())

  return {
    async runBatch(input) {
      const limit = normalizeLimit(input.limit)
      const leased = await repository.leaseBatch(input.appId, { limit, now: now() })
      const results = [...leased.reaped]
      for (const event of leased.events) {
        results.push(await processEvent(event))
      }
      return {
        leased: leased.events.length,
        reaped: leased.reaped.length,
        delivered: results.filter(item => item.status === 'DELIVERED').length,
        retried: results.filter(item => item.status === 'RETRY').length,
        dead: results.filter(item => item.status === 'DEAD').length,
        ignored: results.filter(item => item.status === 'IGNORED').length,
        results,
      }
    },
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

function normalizeLimit(value) {
  const limit = value === undefined ? 5 : Number(value)
  if (!Number.isInteger(limit) || limit < 1 || limit > 10) {
    throw new Error('VALIDATION_FAILED')
  }
  return limit
}

function safeError(error) {
  const code = error instanceof Error ? error.message : ''
  return /^[A-Z][A-Z0-9_]{2,63}$/.test(code) ? code : 'OUTBOX_DELIVERY_FAILED'
}

module.exports = { createOutboxService, normalizeLimit, safeError, terminalErrors }
