'use strict'

const TEMPLATE_KEYS = Object.freeze([
  'registration',
  'event_update',
  'event_reminder',
  'event_cancel',
  'refund',
])

function record(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
}

function parseTemplateConfig(raw = process.env.MEMBERSHIP_SUBSCRIBE_TEMPLATES_JSON || '') {
  if (!raw || !String(raw).trim()) {
    return {}
  }
  let parsed
  try {
    parsed = JSON.parse(raw)
  }
  catch {
    throw new Error('SUBSCRIBE_TEMPLATE_CONFIG_INVALID')
  }
  if (!record(parsed)) {
    throw new Error('SUBSCRIBE_TEMPLATE_CONFIG_INVALID')
  }
  const result = {}
  for (const key of TEMPLATE_KEYS) {
    const entry = parsed[key]
    if (entry === undefined) {
      continue
    }
    if (!record(entry)
      || typeof entry.templateId !== 'string'
      || !entry.templateId.trim()
      || !record(entry.fields)) {
      throw new Error('SUBSCRIBE_TEMPLATE_CONFIG_INVALID')
    }
    const fields = {}
    for (const [logicalName, keyword] of Object.entries(entry.fields)) {
      if (!/^[a-z][a-z0-9_]{0,31}$/i.test(logicalName)
        || typeof keyword !== 'string'
        || !/^[a-z]+\d+$/i.test(keyword)) {
        throw new Error('SUBSCRIBE_TEMPLATE_CONFIG_INVALID')
      }
      fields[logicalName] = keyword
    }
    if (!Object.keys(fields).length) {
      throw new Error('SUBSCRIBE_TEMPLATE_CONFIG_INVALID')
    }
    result[key] = {
      templateId: entry.templateId.trim(),
      fields,
    }
  }
  return result
}

function maxLengthForKeyword(keyword) {
  const prefix = String(keyword).match(/^[a-z]+/i)?.[0]?.toLowerCase()
  if (prefix === 'phrase') return 5
  if (prefix === 'thing') return 20
  if (prefix === 'name') return 10
  if (prefix === 'character_string') return 32
  return 32
}

function safeValue(value, keyword) {
  const normalized = String(value ?? '').replace(/\s+/g, ' ').trim() || '—'
  return normalized.slice(0, maxLengthForKeyword(keyword))
}

function renderTemplateData(template, payload) {
  if (!template || !record(payload)) {
    throw new Error('SUBSCRIBE_TEMPLATE_PAYLOAD_INVALID')
  }
  return Object.fromEntries(Object.entries(template.fields).map(([logicalName, keyword]) => [
    keyword,
    { value: safeValue(payload[logicalName], keyword) },
  ]))
}

module.exports = {
  TEMPLATE_KEYS,
  parseTemplateConfig,
  renderTemplateData,
}
