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

function buildWechatRequest(config, task, recipient, options = {}) {
  if (!config) throw new Error('TEMPLATE_MISSING')
  const payload = parseObject(task.payload_json)
  const input = payload.fields
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('DELIVERY_PAYLOAD_INVALID')
  }
  const data = {}
  for (const [logical, keyword] of Object.entries(config.fields)) {
    const value = text(input[logical])
    if (!value || value.length > 100) throw new Error('DELIVERY_PAYLOAD_INVALID')
    data[keyword] = { value }
  }
  const page = normalizePage(task.target_route)
  return {
    touser: recipient,
    templateId: config.templateId,
    page,
    data,
    miniprogramState: ['developer', 'trial', 'formal'].includes(options.miniprogramState)
      ? options.miniprogramState
      : 'trial',
    lang: 'zh_CN',
  }
}

function normalizePage(value) {
  const page = text(value).replace(/^\//, '')
  if (!page || page.length > 300 || !/^(?:pages|packages)\/[A-Za-z0-9_/?=&.%:-]+$/.test(page)) {
    throw new Error('DELIVERY_PAYLOAD_INVALID')
  }
  return page
}

function parseObject(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value
  try {
    const parsed = JSON.parse(value || '{}')
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  }
  catch {
    return {}
  }
}

function text(value) {
  return typeof value === 'string' ? value.trim() : ''
}

module.exports = {
  buildWechatRequest,
  normalizePage,
  parseObject,
  parseTemplateConfig,
  templateFieldContracts,
}
