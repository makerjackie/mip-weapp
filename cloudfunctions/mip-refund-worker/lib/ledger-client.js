'use strict'

const { createHmac, randomBytes } = require('node:crypto')

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function createLedgerClient(options) {
  if (!options.functionName
    || typeof options.secret !== 'string'
    || options.secret.length < 32) {
    throw new Error('LEDGER_CONFIG_REQUIRED')
  }
  return async function callLedger(action, appId, data = {}) {
    const payload = {
      ...data,
      action,
      appId,
      signedAt: Date.now(),
      nonce: randomBytes(12).toString('hex'),
    }
    const signature = createHmac('sha256', options.secret).update(canonical(payload)).digest('hex')
    const response = await options.cloud.callFunction({
      name: options.functionName,
      data: { ...payload, signature },
    })
    const envelope = response?.result
    if (!envelope || envelope.ok !== true) {
      throw new Error(envelope?.error?.code || 'LEDGER_REQUEST_FAILED')
    }
    return envelope.data
  }
}

module.exports = { canonical, createLedgerClient }
