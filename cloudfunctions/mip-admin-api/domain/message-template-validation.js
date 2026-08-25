'use strict'

const { AdminError, requiredId, text } = require('./validation')

const TEMPLATE_STATUSES = Object.freeze(['DRAFT', 'ACTIVE', 'ARCHIVED'])

function normalizeMessageTemplateDraft(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AdminError('VALIDATION_FAILED', '消息模板内容无效')
  }
  if (!['PLATFORM', 'BRANCH'].includes(value.scopeType)) {
    throw new AdminError('VALIDATION_FAILED', '消息模板范围无效')
  }
  const scopeType = value.scopeType
  return {
    scopeType,
    branchId: scopeType === 'BRANCH' ? requiredId(value.branchId, '城市分会') : null,
    name: text(value.name, 100, { required: true, label: '模板名称' }),
    title: text(value.title, 100, { required: true, label: '消息标题' }),
    body: text(value.body, 500, { required: true, label: '消息正文' }),
  }
}

function normalizeMessageTemplateFilters(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AdminError('VALIDATION_FAILED', '消息模板筛选条件无效')
  }
  const status = typeof value.status === 'string' ? value.status.trim().toUpperCase() : ''
  if (status && !TEMPLATE_STATUSES.includes(status)) {
    throw new AdminError('VALIDATION_FAILED', '消息模板状态无效')
  }
  return { status, query: text(value.query, 80) }
}

module.exports = {
  TEMPLATE_STATUSES,
  normalizeMessageTemplateDraft,
  normalizeMessageTemplateFilters,
}
