'use strict'

const { createHash, createHmac, randomBytes } = require('node:crypto')

function stableJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`
}

function businessPayload(event) {
  const body = Object.fromEntries(
    Object.entries(event).filter(([key]) => !['signature', 'timestamp'].includes(key)),
  )
  return [
    Number(event.timestamp),
    String(event.action || '').trim(),
    String(event.appId || '').trim(),
    createHash('sha256').update(stableJson(body)).digest('hex'),
  ].join('\n')
}

function createRefundWorkerClient(options) {
  if (!options.functionName
    || typeof options.secret !== 'string'
    || options.secret.length < 32) {
    throw new Error('REFUND_DISPATCH_CONFIG_REQUIRED')
  }
  async function call(action, input) {
    const request = {
      action,
      appId: input.appId,
      ...(input.refundId ? { refundId: input.refundId } : {}),
      ...(input.refundIds ? { refundIds: input.refundIds } : {}),
      nonce: randomBytes(12).toString('hex'),
      timestamp: Date.now(),
    }
    const signature = createHmac('sha256', options.secret).update(businessPayload(request)).digest('hex')
    const response = await options.cloud.callFunction({
      name: options.functionName,
      data: { ...request, signature },
    })
    const envelope = response?.result
    if (!envelope || envelope.ok !== true) {
      throw new Error(envelope?.error?.code || 'REFUND_DISPATCH_UNAVAILABLE')
    }
    return envelope.data
  }
  return {
    dispatchRefund: input => call('dispatchRefund', input),
    dispatchRefunds: input => call('dispatchRefunds', input),
  }
}

module.exports = { businessPayload, createRefundWorkerClient, stableJson }
