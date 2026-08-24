'use strict'

const { EXCEPTION_STATUSES, EXCEPTION_TYPES } = require('./operational-exceptions')
const { AdminError, limit } = require('./validation')

const FINANCE_TYPES = Object.freeze(['REFUND', 'PAYMENT'])

function availableExceptionTypes(bindings) {
  const platformRoles = new Set((bindings || [])
    .filter(binding => binding.scopeType === 'PLATFORM')
    .map(binding => binding.roleKey))
  if (platformRoles.has('PLATFORM_OWNER') || platformRoles.has('PLATFORM_OPERATIONS')) {
    return [...EXCEPTION_TYPES]
  }
  if (platformRoles.has('PLATFORM_FINANCE')) return [...FINANCE_TYPES]
  return []
}

function normalizeExceptionRequest(input, availableTypes) {
  const type = normalizedOptional(input?.type)
  const status = normalizedOptional(input?.status)
  if (type && !EXCEPTION_TYPES.includes(type)) {
    throw new AdminError('VALIDATION_FAILED', '异常类型无效')
  }
  if (type && !availableTypes.includes(type)) {
    throw new AdminError('FORBIDDEN', '当前账号没有查看该异常类型的权限')
  }
  if (status && !EXCEPTION_STATUSES.includes(status)) {
    throw new AdminError('VALIDATION_FAILED', '异常状态无效')
  }
  return {
    types: type ? [type] : [...availableTypes],
    statuses: status ? [status] : [...EXCEPTION_STATUSES],
    type,
    status,
    limit: limit(input?.limit || 50, 100),
  }
}

function normalizedOptional(value) {
  return typeof value === 'string' ? value.trim().toUpperCase() : ''
}

module.exports = {
  FINANCE_TYPES,
  availableExceptionTypes,
  normalizeExceptionRequest,
}
