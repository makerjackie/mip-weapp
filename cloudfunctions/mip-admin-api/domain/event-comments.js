'use strict'

const { CAPABILITIES } = require('./capabilities')
const {
  AdminError,
  expectedVersion,
  requiredId,
  text,
} = require('./validation')

function createAdminEventComments({ access, repository }) {
  if (!access || typeof access.session !== 'function'
    || typeof access.eventAuthorization !== 'function'
    || typeof access.mutationAuthorization !== 'function'
    || typeof access.audit !== 'function'
    || !repository) {
    throw new TypeError('Event comment administration service is invalid')
  }

  async function authorizeEvent(caller, input) {
    const context = await access.session(caller)
    const eventId = requiredId(input?.eventId, '活动')
    const authorization = await access.eventAuthorization(
      context,
      eventId,
      CAPABILITIES.EVENTS_COMMENTS_MANAGE,
    )
    return { context, eventId, ...authorization }
  }

  async function getEventCommentAdminState(caller, input = {}) {
    const { context, eventId } = await authorizeEvent(caller, input)
    exactInput(input, ['eventId'])
    const state = await repository.getEventCommentAdminState(context.caller.appId, eventId)
    if (!state?.event || state.event.id !== eventId) {
      throw new AdminError('CONFLICT', '活动评论数据已变化')
    }
    return {
      event: state.event,
      settings: state.settings,
      comments: state.comments,
      reports: state.reports.map(report => ({
        id: report.id,
        commentId: report.commentId,
        commentAuthorNickname: report.commentAuthorNickname,
        commentBody: report.commentBody,
        commentStatus: report.commentStatus,
        reporterNickname: report.reporterNickname,
        category: report.category,
        description: report.description,
        status: report.status,
        version: report.version,
        claimedByMe: report.reviewedByUserId === context.caller.userId,
        createdAt: report.createdAt,
        reviewedAt: report.reviewedAt,
      })),
    }
  }

  async function saveEventCommentSettings(caller, input = {}) {
    const { context, eventId, scope, grant } = await authorizeEvent(caller, input)
    exactInput(input, ['eventId', 'expectedVersion', 'settings'])
    const settings = commentSettings(input.settings)
    const version = nonNegativeVersion(input.expectedVersion)
    return repository.saveEventCommentSettings({
      appId: context.caller.appId,
      actorUserId: context.caller.userId,
      eventId,
      expectedVersion: version,
      settings,
      authorization: access.mutationAuthorization(grant, CAPABILITIES.EVENTS_COMMENTS_MANAGE),
      audit: nextVersion => access.audit(context, grant, {
        scopeType: scope.scopeType,
        scopeId: scope.scopeId,
        action: 'admin.event_comments.settings.update',
        resourceType: 'EVENT_COMMENT_SETTINGS',
        resourceId: eventId,
        metadata: { expectedVersion: version, nextVersion },
      }),
    })
  }

  async function moderateEventComment(caller, input = {}) {
    const { context, eventId, scope, grant } = await authorizeEvent(caller, input)
    exactInput(input, ['eventId', 'commentId', 'expectedVersion', 'action', 'reason'])
    const commentId = requiredId(input.commentId, '评论')
    const action = ['PUBLISH', 'HIDE'].includes(input.action) ? input.action : null
    if (!action) {
      throw new AdminError('VALIDATION_FAILED', '审核操作无效')
    }
    const reason = text(input.reason, 300, { required: true, label: '审核原因' })
    const version = expectedVersion(input.expectedVersion)
    return repository.moderateEventComment({
      appId: context.caller.appId,
      actorUserId: context.caller.userId,
      eventId,
      commentId,
      action,
      reason,
      expectedVersion: version,
      authorization: access.mutationAuthorization(grant, CAPABILITIES.EVENTS_COMMENTS_MANAGE),
      audit: (status, nextVersion) => access.audit(context, grant, {
        scopeType: scope.scopeType,
        scopeId: scope.scopeId,
        action: action === 'PUBLISH'
          ? 'admin.event_comments.publish'
          : 'admin.event_comments.hide',
        resourceType: 'EVENT_COMMENT',
        resourceId: commentId,
        metadata: {
          eventId,
          status,
          expectedVersion: version,
          nextVersion,
          reasonLength: reason.length,
        },
      }),
    })
  }

  async function claimEventCommentReport(caller, input = {}) {
    const { context, eventId, scope, grant } = await authorizeEvent(caller, input)
    exactInput(input, ['eventId', 'reportId', 'expectedVersion'])
    const reportId = requiredId(input.reportId, '举报')
    const version = expectedVersion(input.expectedVersion)
    return repository.claimEventCommentReport({
      appId: context.caller.appId,
      actorUserId: context.caller.userId,
      eventId,
      reportId,
      expectedVersion: version,
      authorization: access.mutationAuthorization(grant, CAPABILITIES.EVENTS_COMMENTS_MANAGE),
      audit: (commentId, status, nextVersion) => access.audit(context, grant, {
        scopeType: scope.scopeType,
        scopeId: scope.scopeId,
        action: 'admin.event_comment_reports.claim',
        resourceType: 'EVENT_COMMENT_REPORT',
        resourceId: reportId,
        metadata: { eventId, commentId, status, expectedVersion: version, nextVersion },
      }),
    })
  }

  async function closeEventCommentReport(caller, input = {}) {
    const { context, eventId, scope, grant } = await authorizeEvent(caller, input)
    exactInput(input, ['eventId', 'reportId', 'expectedVersion', 'decision', 'reason'])
    const reportId = requiredId(input.reportId, '举报')
    const decision = ['RESOLVED', 'DISMISSED'].includes(input.decision) ? input.decision : null
    if (!decision) {
      throw new AdminError('VALIDATION_FAILED', '举报处理结果无效')
    }
    const reason = text(input.reason, 300, { required: true, label: '处理原因' })
    const version = expectedVersion(input.expectedVersion)
    return repository.closeEventCommentReport({
      appId: context.caller.appId,
      actorUserId: context.caller.userId,
      eventId,
      reportId,
      decision,
      reason,
      expectedVersion: version,
      authorization: access.mutationAuthorization(grant, CAPABILITIES.EVENTS_COMMENTS_MANAGE),
      audit: (commentId, status, nextVersion) => access.audit(context, grant, {
        scopeType: scope.scopeType,
        scopeId: scope.scopeId,
        action: 'admin.event_comment_reports.close',
        resourceType: 'EVENT_COMMENT_REPORT',
        resourceId: reportId,
        metadata: {
          eventId,
          commentId,
          status,
          expectedVersion: version,
          nextVersion,
          reasonLength: reason.length,
        },
      }),
    })
  }

  return {
    claimEventCommentReport,
    closeEventCommentReport,
    getEventCommentAdminState,
    moderateEventComment,
    saveEventCommentSettings,
  }
}

function commentSettings(value) {
  if (!exactRecord(value, ['commentsEnabled', 'moderationMode'])
    || typeof value.commentsEnabled !== 'boolean'
    || !['AUTO', 'REVIEW'].includes(value.moderationMode)) {
    throw new AdminError('VALIDATION_FAILED', '评论设置无效')
  }
  return {
    commentsEnabled: value.commentsEnabled,
    moderationMode: value.moderationMode,
  }
}

function exactRecord(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }
  const expected = new Set(keys)
  const actual = Reflect.ownKeys(value)
  return actual.length === expected.size
    && actual.every(key => typeof key === 'string' && expected.has(key))
}

function exactInput(value, keys) {
  if (!exactRecord(value, keys)) {
    throw new AdminError('VALIDATION_FAILED', '活动评论请求无效')
  }
}

function nonNegativeVersion(value) {
  const version = Number(value)
  if (!Number.isInteger(version) || version < 0) {
    throw new AdminError('VALIDATION_FAILED', '记录版本无效')
  }
  return version
}

module.exports = { createAdminEventComments }
