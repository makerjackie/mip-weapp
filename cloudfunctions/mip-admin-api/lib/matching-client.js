'use strict'

const { createHash, createHmac, randomBytes } = require('node:crypto')

function createMatchingClient(options = {}) {
  const configured = Boolean(
    options.cloud
    && typeof options.cloud.callFunction === 'function'
    && /^mip-[a-z0-9][a-z0-9-]{0,55}$/.test(String(options.functionName || ''))
    && typeof options.secret === 'string'
    && options.secret.length >= 32,
  )
  return {
    configured,
    async recalculate(input) {
      if (!configured) { throw new Error('MATCHING_DISPATCH_CONFIG_REQUIRED') }
      const request = {
        action: 'recalculateMatchingInternal',
        appId: input.appId,
        actorUserId: input.actorUserId,
        requesterUserId: input.requesterUserId,
        opportunityId: input.opportunityId,
        sourceVersion: input.sourceVersion,
        idempotencyKey: input.idempotencyKey,
        nonce: randomBytes(12).toString('hex'),
        timestamp: Date.now(),
      }
      request.signature = sign(request, options.secret)
      const response = await options.cloud.callFunction({
        name: options.functionName,
        data: request,
      })
      if (response?.result?.ok !== true) {
        throw new Error(response?.result?.error?.code || 'MATCHING_DISPATCH_UNAVAILABLE')
      }
      return response.result.data
    },
  }
}

function sign(event, secret) {
  return createHmac('sha256', secret).update(canonical(event)).digest('hex')
}

function canonical(event) {
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

function stableJson(value) {
  if (value === null || typeof value !== 'object') { return JSON.stringify(value) }
  if (Array.isArray(value)) { return `[${value.map(stableJson).join(',')}]` }
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`
}

module.exports = { canonical, createMatchingClient, sign }
