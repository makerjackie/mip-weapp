'use strict'

const { CAPABILITIES, authorize } = require('./capabilities')
const {
  AdminError,
  expectedVersion,
  limit,
  requiredId,
  text,
} = require('./validation')

const LIST_INPUT_KEYS = new Set(['status', 'limit'])
const CLAIM_INPUT_KEYS = new Set(['reportId', 'expectedVersion', 'reason'])
const CLOSE_INPUT_KEYS = new Set(['reportId', 'expectedVersion', 'outcome', 'reason'])

function createAdminCommunityGovernance({ repository, access }) {
  async function listCommunityReports(caller, input = {}) {
    const context = await access.session(caller)
    allowedInput(input, LIST_INPUT_KEYS, '举报列表请求格式无效')
    platformGrant(context)
    const status = normalizeCommunityReportStatus(input.status, { optional: true })
    return {
      items: await repository.listCommunityReports(
        context.caller.appId,
        status,
        limit(input.limit, 50),
      ),
      nextCursor: null,
    }
  }

  async function claimCommunityReport(caller, input = {}) {
    const context = await access.session(caller)
    allowedInput(input, CLAIM_INPUT_KEYS, '举报认领请求格式无效')
    const grant = platformGrant(context)
    const reportId = requiredId(input.reportId, '社区举报')
    const version = expectedVersion(input.expectedVersion)
    const reason = normalizedCommunityReportReason(input.reason)
    return repository.claimCommunityReport({
      appId: context.caller.appId,
      actorUserId: context.caller.userId,
      reportId,
      expectedVersion: version,
      authorization: access.mutationAuthorization(
        grant,
        CAPABILITIES.COMMUNITY_REPORTS_MANAGE,
      ),
      audit: access.audit(context, grant, {
        scopeType: 'PLATFORM',
        scopeId: null,
        action: 'admin.community_reports.claim',
        resourceType: 'COMMUNITY_REPORT',
        resourceId: reportId,
        metadata: { expectedVersion: version, reason },
      }),
    })
  }

  async function closeCommunityReport(caller, input = {}) {
    const context = await access.session(caller)
    allowedInput(input, CLOSE_INPUT_KEYS, '举报处理请求格式无效')
    const grant = platformGrant(context)
    const reportId = requiredId(input.reportId, '社区举报')
    const version = expectedVersion(input.expectedVersion)
    const outcome = normalizeCommunityReportStatus(input.outcome)
    if (!['RESOLVED', 'DISMISSED'].includes(outcome)) {
      throw new AdminError('VALIDATION_FAILED', '举报处理结果无效')
    }
    const reason = normalizedCommunityReportReason(input.reason)
    return repository.closeCommunityReport({
      appId: context.caller.appId,
      actorUserId: context.caller.userId,
      reportId,
      expectedVersion: version,
      outcome,
      reason,
      authorization: access.mutationAuthorization(
        grant,
        CAPABILITIES.COMMUNITY_REPORTS_MANAGE,
      ),
      audit: access.audit(context, grant, {
        scopeType: 'PLATFORM',
        scopeId: null,
        action: outcome === 'RESOLVED'
          ? 'admin.community_reports.resolve'
          : 'admin.community_reports.dismiss',
        resourceType: 'COMMUNITY_REPORT',
        resourceId: reportId,
        metadata: { expectedVersion: version, outcome, reason },
      }),
    })
  }

  return {
    claimCommunityReport,
    closeCommunityReport,
    listCommunityReports,
  }
}

function allowedInput(value, allowedKeys, message) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AdminError('VALIDATION_FAILED', message)
  }
  const keys = Reflect.ownKeys(value)
  if (keys.some(key => typeof key !== 'string' || !allowedKeys.has(key))) {
    throw new AdminError('VALIDATION_FAILED', message)
  }
}

function platformGrant(context) {
  return authorize(context.bindings, CAPABILITIES.COMMUNITY_REPORTS_MANAGE, {
    scopeType: 'PLATFORM',
    scopeId: null,
  })
}

function normalizeCommunityReportStatus(value, { optional = false } = {}) {
  const status = typeof value === 'string' ? value.trim().toUpperCase() : ''
  if (optional && !status) {
    return ''
  }
  if (!['PENDING', 'REVIEWING', 'RESOLVED', 'DISMISSED'].includes(status)) {
    throw new AdminError('VALIDATION_FAILED', '举报状态无效')
  }
  return status
}

function normalizedCommunityReportReason(value) {
  const normalized = typeof value === 'string'
    ? value.normalize('NFKC').trim().replace(/\s+/g, ' ')
    : value
  return text(normalized, 300, { required: true, label: '处理原因' })
}

module.exports = { createAdminCommunityGovernance }
