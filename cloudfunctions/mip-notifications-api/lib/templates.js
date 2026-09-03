'use strict'

const keywordPattern = /^(?:thing|time|date|amount|phone_number|phrase|character_string|number)\d+$/
const templateFieldContracts = Object.freeze({
  EVENT_REMINDER: Object.freeze(new Set(['title', 'startsAt', 'description', 'location'])),
  CHECKIN_RESULT: Object.freeze(new Set(['title', 'checkedAt', 'status'])),
  HEART_RECEIVED: Object.freeze(new Set(['title', 'status'])),
})

function parseTemplateConfig(source) {
  if (typeof source !== 'string' || !source.trim()) return {}
  let parsed
  try {
    parsed = JSON.parse(source)
  }
  catch {
    throw new Error('NOTIFICATION_TEMPLATE_CONFIG_INVALID')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('NOTIFICATION_TEMPLATE_CONFIG_INVALID')
  }
  return Object.fromEntries(Object.entries(parsed).map(([key, value]) => {
    if (!/^[A-Z][A-Z0-9_]{2,79}$/.test(key)
      || !value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('NOTIFICATION_TEMPLATE_CONFIG_INVALID')
    }
    const templateId = text(value.templateId)
    const fields = value.fields
    if (!templateId || templateId.length > 128
      || !fields || typeof fields !== 'object' || Array.isArray(fields)
      || Object.keys(fields).length < 1 || Object.keys(fields).length > 10) {
      throw new Error('NOTIFICATION_TEMPLATE_CONFIG_INVALID')
    }
    const normalizedFields = Object.fromEntries(Object.entries(fields).map(([logical, keyword]) => {
      if (!/^[a-z][a-zA-Z0-9_]{0,39}$/.test(logical) || !keywordPattern.test(text(keyword))) {
        throw new Error('NOTIFICATION_TEMPLATE_CONFIG_INVALID')
      }
      const contract = templateFieldContracts[key]
      if (contract && !contract.has(logical)) {
        throw new Error('NOTIFICATION_TEMPLATE_CONFIG_INVALID')
      }
      return [logical, text(keyword)]
    }))
    return [key, { templateId, fields: normalizedFields }]
  }))
}

function text(value) {
  return typeof value === 'string' ? value.trim() : ''
}

module.exports = { parseTemplateConfig, templateFieldContracts }
