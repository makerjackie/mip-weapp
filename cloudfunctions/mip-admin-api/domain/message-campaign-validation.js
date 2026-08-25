'use strict'

const { AdminError, requiredId, stableKey, text } = require('./validation')

const PROFILE_REF_PATTERN = /^p1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{48}\.[A-Za-z0-9_-]{22}$/

function normalizeMessageCampaignDraft(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AdminError('VALIDATION_FAILED', '消息活动内容无效')
  }
  const scopeType = value.scopeType === 'BRANCH' ? 'BRANCH' : 'PLATFORM'
  const branchId = scopeType === 'BRANCH' ? requiredId(value.branchId, '城市分会') : null
  const audienceType = value.audienceType === 'EXPLICIT' ? 'EXPLICIT' : 'ALL'
  const recipientRefs = audienceType === 'EXPLICIT' ? profileRefs(value.recipientRefs) : []
  return {
    scopeType,
    branchId,
    audienceType,
    recipientRefs,
    name: text(value.name, 100, { required: true, label: '活动名称' }),
    title: text(value.title, 100, { required: true, label: '消息标题' }),
    body: text(value.body, 500, { required: true, label: '消息正文' }),
  }
}

function normalizeMessageCampaignFilters(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AdminError('VALIDATION_FAILED', '消息活动筛选条件无效')
  }
  const status = typeof value.status === 'string' ? value.status.trim().toUpperCase() : ''
  if (status && !['DRAFT', 'READY', 'PUBLISHED', 'WITHDRAWN'].includes(status)) {
    throw new AdminError('VALIDATION_FAILED', '消息活动状态无效')
  }
  return { status, query: text(value.query, 80) }
}

function normalizeRecipientSearch(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AdminError('VALIDATION_FAILED', '收件人筛选条件无效')
  }
  const branchId = value.branchId ? requiredId(value.branchId, '城市分会') : null
  return { branchId, query: text(value.query, 80) }
}

function normalizePublishKey(value) {
  const key = stableKey(value, '发布请求', 96)
  if (key.length < 12) throw new AdminError('VALIDATION_FAILED', '发布请求标识无效')
  return key
}

function normalizeScheduledFor(value) {
  const source = typeof value === 'string' ? value.trim() : ''
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(source)) {
    throw new AdminError('VALIDATION_FAILED', '定时发布时间必须使用 UTC 时间')
  }
  const scheduledFor = new Date(source)
  if (!Number.isFinite(scheduledFor.getTime()) || scheduledFor.getUTCFullYear() >= 2100) {
    throw new AdminError('VALIDATION_FAILED', '定时发布时间无效')
  }
  return scheduledFor
}

function normalizeOptionalDispatchVersion(value) {
  if (value === undefined || value === null) return null
  if (!Number.isInteger(value) || value < 1) {
    throw new AdminError('VALIDATION_FAILED', '定时计划版本无效')
  }
  return value
}

function profileRefs(value) {
  if (!Array.isArray(value) || !value.length || value.length > 100) {
    throw new AdminError('VALIDATION_FAILED', '请选择 1 至 100 个收件人')
  }
  const selected = [...new Set(value.map(item => typeof item === 'string' ? item.trim() : ''))]
  if (selected.length !== value.length || selected.some(item => !PROFILE_REF_PATTERN.test(item))) {
    throw new AdminError('VALIDATION_FAILED', '收件人信息无效')
  }
  return selected
}

module.exports = {
  normalizeMessageCampaignDraft,
  normalizeMessageCampaignFilters,
  normalizeOptionalDispatchVersion,
  normalizePublishKey,
  normalizeRecipientSearch,
  normalizeScheduledFor,
}
