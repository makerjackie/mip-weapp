'use strict'

const { normalizeIngestionItem } = require('./knowledge')
const { MAX_SOURCES_PER_RUN } = require('./knowledge-scheduling-repository')

function createKnowledgeSchedulingService(options = {}) {
  const { fetchSource, repository } = options
  if (typeof fetchSource !== 'function'
    || !repository
    || typeof repository.claimDue !== 'function'
    || typeof repository.completeFailure !== 'function'
    || typeof repository.completeSuccess !== 'function'
    || typeof repository.getWakePlan !== 'function'
    || typeof repository.validateClaim !== 'function') {
    throw new TypeError('KNOWLEDGE_SCHEDULING_DEPENDENCIES_INVALID')
  }
  const allowedHosts = options.webviewAllowedHosts

  async function getWakePlan(input) {
    return repository.getWakePlan({ appId: input.appId })
  }

  async function runDue(input) {
    const claimed = await repository.claimDue({
      appId: input.appId,
      limit: boundedLimit(input.limit),
    })
    const outcomes = []
    for (const claim of claimed.claims) {
      outcomes.push(await executeClaim(claim))
    }
    return summarize(outcomes, claimed.reconciled)
  }

  async function executeClaim(claim) {
    const validation = await repository.validateClaim(claim)
    if (validation.status === 'LEASE_LOST') return { scheduleId: claim.scheduleId, status: 'LEASE_LOST' }
    if (validation.status !== 'RUNNABLE') {
      return repository.completeFailure(claim, 'KNOWLEDGE_SCHEDULE_AUTH_REVOKED')
    }
    try {
      const fetched = await fetchSource({
        endpoint_url: claim.endpointUrl,
        fetch_config_json: claim.fetchConfig,
        id: claim.sourceId,
        source_type: claim.sourceType,
      })
      const items = normalizedWorkerItems(fetched, allowedHosts)
      if (!items.length) throw codeError('KNOWLEDGE_SOURCE_RESPONSE_INVALID')
      return await repository.completeSuccess(claim, items)
    }
    catch (error) {
      if (error?.message === 'KNOWLEDGE_SCHEDULE_LEASE_LOST') {
        return { scheduleId: claim.scheduleId, status: 'LEASE_LOST' }
      }
      return repository.completeFailure(claim, workerErrorCode(error))
    }
  }

  return { getWakePlan, runDue }
}

function normalizedWorkerItems(value, allowedHosts) {
  const source = Array.isArray(value) ? value.slice(0, 50) : []
  const seen = new Set()
  const items = []
  for (const raw of source) {
    const normalized = normalizeIngestionItem(raw, { allowedHosts })
    if (seen.has(normalized.externalId)) continue
    seen.add(normalized.externalId)
    items.push({
      ...normalized,
      accessType: 'FREE',
      bodyText: normalized.bodyText || normalized.summary,
      contentType: 'HOT_NEWS',
      contentSafetyStatus: 'PENDING',
      status: 'PENDING_REVIEW',
    })
  }
  return items
}

function summarize(outcomes, reconciled) {
  const result = {
    claimed: outcomes.length,
    completed: 0,
    failed: 0,
    leaseLost: 0,
    reconciled: Number(reconciled || 0),
    outcomes: [],
  }
  for (const outcome of outcomes) {
    if (outcome.status === 'COMPLETED') result.completed += 1
    else if (outcome.status === 'LEASE_LOST') result.leaseLost += 1
    else result.failed += 1
    result.outcomes.push({
      errorCode: publicErrorCode(outcome.errorCode),
      nextRunAt: typeof outcome.nextRunAt === 'string' ? outcome.nextRunAt : null,
      retryDisposition: ['RETRY', 'NEXT_DAY'].includes(outcome.retryDisposition)
        ? outcome.retryDisposition
        : null,
      status: ['COMPLETED', 'FAILED', 'LEASE_LOST'].includes(outcome.status)
        ? outcome.status
        : 'FAILED',
    })
  }
  return result
}

function boundedLimit(value) {
  const result = Number(value || MAX_SOURCES_PER_RUN)
  if (!Number.isInteger(result) || result < 1 || result > MAX_SOURCES_PER_RUN) {
    throw codeError('VALIDATION_FAILED')
  }
  return result
}

function workerErrorCode(error) {
  const code = String(error?.code || error?.message || '').trim()
  const allowed = new Set([
    'KNOWLEDGE_SCHEDULE_AUTH_REVOKED',
    'KNOWLEDGE_SOURCE_FETCH_UNAVAILABLE',
    'KNOWLEDGE_SOURCE_RESPONSE_INVALID',
  ])
  return allowed.has(code) ? code : 'KNOWLEDGE_SOURCE_FETCH_UNAVAILABLE'
}

function publicErrorCode(value) {
  const code = String(value || '').trim()
  return /^[A-Z][A-Z0-9_]{2,63}$/.test(code) ? code : null
}

function codeError(code) {
  const error = new Error(code)
  error.code = code
  return error
}

module.exports = {
  createKnowledgeSchedulingService,
  normalizedWorkerItems,
  summarize,
}
