'use strict'

function createOperationCache(options = {}) {
  const maximumEntries = positiveInteger(options.maximumEntries, 100)
  const ttlMs = positiveInteger(options.ttlMs, 4 * 60 * 1000)
  const entries = new Map()

  async function run(operationKey, payloadDigest, operation) {
    prune()
    const current = entries.get(operationKey)
    if (current) {
      if (current.payloadDigest !== payloadDigest) throw new Error('IDEMPOTENCY_CONFLICT')
      return current.promise
    }
    if (entries.size >= maximumEntries) {
      const settled = [...entries].find(([, entry]) => entry.settled)
      if (!settled) throw new Error('AI_DRAFT_PROVIDER_UPSTREAM_UNAVAILABLE')
      entries.delete(settled[0])
    }
    const entry = {
      payloadDigest,
      expiresAt: Number.POSITIVE_INFINITY,
      promise: Promise.resolve().then(operation),
      settled: false,
    }
    entries.set(operationKey, entry)
    try {
      const result = await entry.promise
      entry.settled = true
      entry.expiresAt = Date.now() + ttlMs
      return result
    }
    catch (error) {
      if (entries.get(operationKey) === entry) entries.delete(operationKey)
      throw error
    }
  }

  function prune() {
    const now = Date.now()
    for (const [key, entry] of entries) {
      if (entry.settled && entry.expiresAt <= now) entries.delete(key)
    }
  }

  return { run }
}

function positiveInteger(value, fallback) {
  const parsed = Number(value ?? fallback)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

module.exports = { createOperationCache }
