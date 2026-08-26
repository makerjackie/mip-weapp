'use strict'

function createOperationCache(options = {}) {
  const requestedMaximumEntries = Number(options.maximumEntries || 4)
  const maximumEntries = Number.isInteger(requestedMaximumEntries)
    && requestedMaximumEntries >= 1
    && requestedMaximumEntries <= 8
    ? requestedMaximumEntries
    : 4
  const entries = new Map()

  async function run(operationKey, payloadDigest, operation) {
    const current = entries.get(operationKey)
    if (current) {
      if (current.payloadDigest !== payloadDigest) throw new Error('IDEMPOTENCY_CONFLICT')
      return current.promise
    }
    if (entries.size >= maximumEntries) {
      throw new Error('DIGITAL_AVATAR_PROVIDER_UPSTREAM_UNAVAILABLE')
    }
    const entry = {
      payloadDigest,
      promise: Promise.resolve().then(operation),
    }
    entries.set(operationKey, entry)
    try {
      return await entry.promise
    }
    finally {
      if (entries.get(operationKey) === entry) entries.delete(operationKey)
    }
  }

  return { run }
}

module.exports = { createOperationCache }
