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
  if (external && !target) {
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
    || value.channel !== 'WECHAT_SUBSCRIPTION'
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
    if (!/^[a-z][a-zA-Z0-9_]{0,39}$/.test(key) || !fieldValue || fieldValue.length > 100) {
      throw new Error('VALIDATION_FAILED')
    }
    return [key, fieldValue]
  }))
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
