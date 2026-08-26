'use strict'

function createOperationCache(options = {}) {
  const maximumEntries = Number(options.maximumEntries || 100)
  const ttlMs = Number(options.ttlMs || 4 * 60 * 1000)
  const entries = new Map()

  async function run(operationKey, payloadDigest, operation) {
    prune()
    const current = entries.get(operationKey)
    if (current) {
      if (current.payloadDigest !== payloadDigest) throw new Error('IDEMPOTENCY_CONFLICT')
      return current.promise
    }
    if (entries.size >= maximumEntries) {
      const oldest = entries.keys().next().value
      entries.delete(oldest)
    }
    const entry = {
      payloadDigest,
      expiresAt: Date.now() + ttlMs,
      promise: Promise.resolve().then(operation),
    }
    entries.set(operationKey, entry)
    try {
      return await entry.promise
    }
    catch (error) {
      if (entries.get(operationKey) === entry) entries.delete(operationKey)
      throw error
    }
  }

  function prune() {
    const now = Date.now()
    for (const [key, entry] of entries) {
      if (entry.expiresAt <= now) entries.delete(key)
    }
  }

  return { run }
}

module.exports = { createOperationCache }
