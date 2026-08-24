'use strict'

function normalizeSubscriptionDecision(templateKey, decision) {
  const normalizedKey = text(templateKey)
  if (!/^[A-Z][A-Z0-9_]{2,79}$/.test(normalizedKey)
    || !['ACCEPTED', 'REJECTED', 'BANNED'].includes(decision)) {
    throw new Error('VALIDATION_FAILED')
  }
  return { templateKey: normalizedKey, decision }
}

function text(value) {
  return typeof value === 'string' ? value.trim() : ''
}

module.exports = { normalizeSubscriptionDecision }
