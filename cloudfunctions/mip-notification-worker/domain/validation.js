'use strict'

const { buildTarget } = require('./routes')

const messageTypes = new Set([
  'MEMBERSHIP',
  'EVENT',
  'OPPORTUNITY',
  'PROFILE_INTEREST',
  'GROWTH',
  'GROWTH_LEVEL_UP',
  'GAME',
  'OPERATIONS',
])

function normalizeMessage(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || !isUuid(input.recipientUserId)) {
    throw new Error('VALIDATION_FAILED')
  }
  const messageType = text(input.messageType).toUpperCase()
  const title = text(input.title)
  const body = text(input.body)
  const dedupeKey = text(input.dedupeKey)
  if (!messageTypes.has(messageType) || !title || title.length > 100
    || !body || body.length > 500 || !dedupeKey || dedupeKey.length > 160) {
    throw new Error('VALIDATION_FAILED')
  }
  const target = buildTarget(input.targetType, input.targetId)
  const external = normalizeExternal(input.external)
  if (external && !target && external.channel !== 'WECHAT_CUSTOMER_SERVICE') {
    throw new Error('VALIDATION_FAILED')
  }
  return {
    recipientUserId: input.recipientUserId,
    messageType,
    title,
    body,
    dedupeKey,
    target,
    external,
  }
}

function normalizeExternal(value) {
  if (value === undefined || value === null) return null
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![
      'WECHAT_SUBSCRIPTION',
      'WECHAT_CUSTOMER_SERVICE',
      'WECHAT_SERVICE_ACCOUNT',
    ].includes(value.channel)
    || !/^[A-Z][A-Z0-9_]{2,79}$/.test(text(value.templateKey))) {
    throw new Error('VALIDATION_FAILED')
  }
  const fields = value.fields
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)
    || Object.keys(fields).length < 1 || Object.keys(fields).length > 10) {
    throw new Error('VALIDATION_FAILED')
  }
  const normalizedFields = Object.fromEntries(Object.entries(fields).map(([key, item]) => {
    const fieldValue = text(item)
    const limit = value.channel === 'WECHAT_CUSTOMER_SERVICE' && key === 'content' ? 600 : 100
    if (!/^[a-z][a-zA-Z0-9_]{0,39}$/.test(key) || !fieldValue || fieldValue.length > limit) {
      throw new Error('VALIDATION_FAILED')
    }
    return [key, fieldValue]
  }))
  if (value.channel === 'WECHAT_CUSTOMER_SERVICE'
    && (text(value.templateKey) !== 'CUSTOMER_SERVICE_TEXT'
      || Object.keys(normalizedFields).length !== 1
      || !normalizedFields.content
      || normalizedFields.content.length > 600)) {
    throw new Error('VALIDATION_FAILED')
  }
  return {
    channel: value.channel,
    templateKey: text(value.templateKey),
    payload: { fields: normalizedFields },
  }
}

function isUuid(value) {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

function text(value) {
  return typeof value === 'string' ? value.trim() : ''
}

module.exports = { normalizeExternal, normalizeMessage }
