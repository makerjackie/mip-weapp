'use strict'

const { createHmac } = require('node:crypto')
const { normalizePage, parseObject } = require('./templates')

const CUSTOMER_SERVICE_TEMPLATE_KEY = 'CUSTOMER_SERVICE_TEXT'
const SERVICE_ACCOUNT_TIMEOUT_MS = 8_000
const templateKeyPattern = /^[A-Z][A-Z0-9_]{2,79}$/

function buildCustomerServiceRequest(task, recipient) {
  if (task.template_key !== CUSTOMER_SERVICE_TEMPLATE_KEY) {
    throw new Error('DELIVERY_PAYLOAD_INVALID')
  }
  const payload = parseObject(task.payload_json)
  const content = text(payload.fields?.content)
  if (!content || content.length > 600) throw new Error('DELIVERY_PAYLOAD_INVALID')
  return {
    touser: recipient,
    msgtype: 'text',
    text: { content },
  }
}

function buildServiceAccountRequest(config, task) {
  const templateId = text(config?.templates?.[task.template_key])
  if (!templateId) throw new Error('TEMPLATE_MISSING')
  const payload = parseObject(task.payload_json)
  const fields = normalizeFields(payload.fields)
  return {
    version: 1,
    idempotencyKey: task.taskId,
    appId: task.app_id,
    recipientUserId: task.recipient_user_id,
    templateId,
    templateKey: task.template_key,
    ...(task.target_route ? { page: normalizePage(task.target_route) } : {}),
    fields,
  }
}

function parseServiceAccountConfig(source) {
  if (typeof source !== 'string' || !source.trim()) return null
  let parsed
  try {
    parsed = JSON.parse(source)
  }
  catch {
    throw new Error('SERVICE_ACCOUNT_ADAPTER_CONFIG_INVALID')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('SERVICE_ACCOUNT_ADAPTER_CONFIG_INVALID')
  }
  const endpoint = normalizeHttpsEndpoint(parsed.endpoint)
  const templates = parsed.templates
  if (!templates || typeof templates !== 'object' || Array.isArray(templates)) {
    throw new Error('SERVICE_ACCOUNT_ADAPTER_CONFIG_INVALID')
  }
  const entries = Object.entries(templates)
  if (entries.length < 1 || entries.length > 10) {
    throw new Error('SERVICE_ACCOUNT_ADAPTER_CONFIG_INVALID')
  }
  return {
    endpoint,
    templates: Object.fromEntries(entries.map(([key, value]) => {
      const templateId = text(value)
      if (!templateKeyPattern.test(key) || !templateId || templateId.length > 128) {
        throw new Error('SERVICE_ACCOUNT_ADAPTER_CONFIG_INVALID')
      }
      return [key, templateId]
    })),
  }
}

function createServiceAccountSender(options) {
  const config = options.config
  const secret = text(options.secret)
  const fetchImpl = options.fetchImpl || fetch
  const clock = options.clock || Date.now
  if (!config || !secret || secret.length < 32 || typeof fetchImpl !== 'function') {
    throw new Error('SERVICE_ACCOUNT_ADAPTER_CONFIG_INVALID')
  }
  return async function send(request) {
    const body = JSON.stringify(request)
    const timestamp = String(Math.floor(Number(clock()) / 1000))
    const signature = createHmac('sha256', secret)
      .update(`${timestamp}\n${body}`)
      .digest('hex')
    let response
    try {
      response = await fetchImpl(config.endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-mip-idempotency-key': request.idempotencyKey,
          'x-mip-signature': `sha256=${signature}`,
          'x-mip-timestamp': timestamp,
        },
        body,
        signal: AbortSignal.timeout(SERVICE_ACCOUNT_TIMEOUT_MS),
      })
    }
    catch {
      throw new Error('WECHAT_SERVICE_ACCOUNT_FAILED')
    }
    if (!response || !response.ok) throw new Error('WECHAT_SERVICE_ACCOUNT_FAILED')
  }
}

function normalizeFields(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('DELIVERY_PAYLOAD_INVALID')
  }
  const entries = Object.entries(value)
  if (entries.length < 1 || entries.length > 10) throw new Error('DELIVERY_PAYLOAD_INVALID')
  return Object.fromEntries(entries.map(([key, value]) => {
    const fieldValue = text(value)
    if (!/^[a-z][a-zA-Z0-9_]{0,39}$/.test(key) || !fieldValue || fieldValue.length > 100) {
      throw new Error('DELIVERY_PAYLOAD_INVALID')
    }
    return [key, fieldValue]
  }))
}

function normalizeHttpsEndpoint(value) {
  try {
    const url = new URL(text(value))
    if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.href.length > 2048) {
      throw new Error()
    }
    return url.href
  }
  catch {
    throw new Error('SERVICE_ACCOUNT_ADAPTER_CONFIG_INVALID')
  }
}

function text(value) {
  return typeof value === 'string' ? value.trim() : ''
}

module.exports = {
  CUSTOMER_SERVICE_TEMPLATE_KEY,
  buildCustomerServiceRequest,
  buildServiceAccountRequest,
  createServiceAccountSender,
  normalizeFields,
  parseServiceAccountConfig,
}
