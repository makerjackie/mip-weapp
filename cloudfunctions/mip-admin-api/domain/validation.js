'use strict'

class AdminError extends Error {
  constructor(code, message, retryable = false) {
    super(message)
    this.name = 'AdminError'
    this.code = code
    this.retryable = retryable
  }
}

function requiredId(value, label = '记录', maximum = 36) {
  const id = typeof value === 'string' ? value.trim() : ''
  if (!id || id.length > maximum || !/^[A-Za-z0-9_-]+$/.test(id)) {
    throw new AdminError('VALIDATION_FAILED', `${label}标识无效`)
  }
  return id
}

function stableKey(value, label, maximum) {
  const key = typeof value === 'string' ? value.trim() : ''
  if (!key || key.length > maximum || !/^[A-Za-z0-9_.:-]+$/.test(key)) {
    throw new AdminError('VALIDATION_FAILED', `${label}标识无效`)
  }
  return key
}

function text(value, max, { required = false, label = '内容' } = {}) {
  const normalized = typeof value === 'string' ? value.trim() : ''
  if ((required && !normalized) || normalized.length > max) {
    throw new AdminError('VALIDATION_FAILED', `${label}格式无效`)
  }
  return normalized
}

function expectedVersion(value) {
  const version = Number(value)
  if (!Number.isInteger(version) || version < 1) {
    throw new AdminError('VALIDATION_FAILED', '记录版本无效')
  }
  return version
}

function limit(value, maximum = 50) {
  const parsed = Number(value || 20)
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new AdminError('VALIDATION_FAILED', '分页数量无效')
  }
  return Math.min(parsed, maximum)
}

function metric(value) {
  if (!['EXPERIENCE', 'CONTRIBUTION'].includes(value)) {
    throw new AdminError('VALIDATION_FAILED', '成长类型无效')
  }
  return value
}

function delta(value) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed === 0 || Math.abs(parsed) > 1_000_000) {
    throw new AdminError('VALIDATION_FAILED', '调整数值无效')
  }
  return parsed
}

module.exports = { AdminError, delta, expectedVersion, limit, metric, requiredId, stableKey, text }
