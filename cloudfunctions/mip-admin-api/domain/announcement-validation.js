'use strict'

const { AdminError, requiredId, text } = require('./validation')

function normalizeAnnouncementDraft(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AdminError('VALIDATION_FAILED', '公告内容无效')
  }
  const scopeType = value.scopeType === 'BRANCH' ? 'BRANCH' : 'PLATFORM'
  const branchId = scopeType === 'BRANCH' ? requiredId(value.branchId, '城市分会') : null
  const targetType = value.targetType === 'EVENT' || value.targetType === 'OPPORTUNITY'
    ? value.targetType
    : null
  const rawTargetId = typeof value.targetId === 'string' ? value.targetId.trim() : ''
  if (Boolean(targetType) !== Boolean(rawTargetId)) {
    throw new AdminError('VALIDATION_FAILED', '公告关联内容无效')
  }
  const visibleFrom = requiredDate(value.visibleFrom, '展示开始时间')
  const visibleUntil = optionalDate(value.visibleUntil, '展示结束时间')
  if (visibleUntil && visibleUntil <= visibleFrom) {
    throw new AdminError('VALIDATION_FAILED', '展示结束时间必须晚于开始时间')
  }
  return {
    scopeType,
    branchId,
    title: text(value.title, 100, { required: true, label: '公告标题' }),
    summary: text(value.summary, 240, { required: true, label: '公告摘要' }),
    body: text(value.body, 5_000, { required: true, label: '公告正文' }),
    targetType,
    targetId: targetType ? requiredId(rawTargetId, '关联内容') : null,
    visibleFrom,
    visibleUntil,
  }
}

function normalizeAnnouncementFilters(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AdminError('VALIDATION_FAILED', '公告筛选条件无效')
  }
  const status = typeof value.status === 'string' ? value.status.trim().toUpperCase() : ''
  if (status && !['DRAFT', 'PUBLISHED', 'WITHDRAWN'].includes(status)) {
    throw new AdminError('VALIDATION_FAILED', '公告状态无效')
  }
  const scopeType = typeof value.scopeType === 'string' ? value.scopeType.trim().toUpperCase() : ''
  if (scopeType && !['PLATFORM', 'BRANCH'].includes(scopeType)) {
    throw new AdminError('VALIDATION_FAILED', '公告范围无效')
  }
  const branchId = value.branchId ? requiredId(value.branchId, '城市分会') : ''
  if (scopeType === 'PLATFORM' && branchId) {
    throw new AdminError('VALIDATION_FAILED', '平台公告不能指定城市分会')
  }
  return {
    status,
    scopeType,
    branchId,
    query: text(value.query, 80),
  }
}

function normalizeAnnouncementReason(value) {
  return text(value, 300, { required: true, label: '撤回原因' })
}

function requiredDate(value, label) {
  const result = optionalDate(value, label)
  if (!result) throw new AdminError('VALIDATION_FAILED', `请填写${label}`)
  return result
}

function optionalDate(value, label) {
  if (value === undefined || value === null || value === '') return null
  const result = new Date(value)
  if (!Number.isFinite(result.getTime())) {
    throw new AdminError('VALIDATION_FAILED', `${label}无效`)
  }
  return result
}

module.exports = {
  normalizeAnnouncementDraft,
  normalizeAnnouncementFilters,
  normalizeAnnouncementReason,
}
