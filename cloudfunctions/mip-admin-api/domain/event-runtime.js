'use strict'

const { CAPABILITIES } = require('./capabilities')
const { decodeCursor } = require('./pagination')
const { AdminError, expectedVersion, requiredId, limit, text } = require('./validation')

function createAdminEventRuntime({ access, repository, createCheckinImage, dispatchRefunds }) {
  async function contextFor(caller, input, capability) {
    const context = await access.session(caller)
    const eventId = requiredId(input.eventId, '活动')
    const { scope, grant } = await access.eventAuthorization(context, eventId, capability)
    return { context, eventId, scope, grant }
  }
  function mutation(state, capability, action, resourceId, reason) {
    return {
      appId: state.context.caller.appId, actorUserId: state.context.caller.userId, eventId: state.eventId,
      authorizedScope: state.scope, authorization: access.mutationAuthorization(state.grant, capability),
      audit: access.audit(state.context, state.grant, { scopeType: 'EVENT', scopeId: state.eventId,
        action, resourceType: 'EVENT_REGISTRATION', resourceId, metadata: { reasonLength: reason?.length || 0 } }),
    }
  }
  async function listEventFeedbacks(caller, input = {}) {
    const state = await contextFor(caller, input, CAPABILITIES.EVENTS_FEEDBACK_READ)
    return repository.listEventFeedbacks(state.context.caller.appId, state.eventId, {
      rating: rating(input.rating ?? input.filters?.rating),
      limit: limit(input.limit), cursor: decodeCursor(input.cursor, ['submittedAt', 'id']),
    })
  }
  async function listEventHearts(caller, input = {}) {
    const state = await contextFor(caller, input, CAPABILITIES.EVENTS_ROSTER)
    return repository.listEventHearts(state.context.caller.appId, state.eventId, {
      limit: limit(input.limit), cursor: decodeCursor(input.cursor, ['updatedAt', 'id']),
    })
  }
  async function getCheckinQrcode(caller, input = {}) {
    const state = await contextFor(caller, input, CAPABILITIES.EVENTS_CHECKIN)
    if (typeof createCheckinImage !== 'function') throw new AdminError('CHECKIN_CODE_UNAVAILABLE', '签到码服务尚未配置', true)
    if (input.mode && !['STATIC', 'ROTATING'].includes(input.mode)) throw new AdminError('VALIDATION_FAILED', '签到码类型无效')
    const credential = await repository.issueAdminCheckinCredential({
      ...mutation(state, CAPABILITIES.EVENTS_CHECKIN, 'admin.events.checkin.credential', state.eventId),
      mode: input.mode || 'STATIC',
    })
    const image = await createCheckinImage({ appId: state.context.caller.appId, scene: credential.scanToken })
    return { eventId: state.eventId, mode: credential.mode, validUntil: credential.validUntil, ...image }
  }
  async function importParticipant(caller, input = {}) {
    const state = await contextFor(caller, input, CAPABILITIES.EVENTS_REGISTRATIONS_MANAGE)
    const userId = requiredId(input.userId, '用户')
    // A display role must never grant membership. Membership is re-read in the transaction.
    if (input.roleMark && !['GUEST', 'MEMBER', 'PLAYER'].includes(input.roleMark)) throw new AdminError('VALIDATION_FAILED', '角色标记无效')
    const reason = text(input.reason, 120, { required: true, label: '补录原因' })
    return repository.importParticipant({ ...mutation(state, CAPABILITIES.EVENTS_REGISTRATIONS_MANAGE,
      'admin.events.participant.import', userId, reason), userId, reason,
      roleMark: input.roleMark || null })
  }
  async function cancelParticipant(caller, input = {}) {
    const state = await contextFor(caller, input, CAPABILITIES.EVENTS_REGISTRATIONS_MANAGE)
    const registrationId = requiredId(input.registrationId, '报名')
    const reason = text(input.reason, 120, { required: true, label: '取消原因' })
    const result = await repository.cancelParticipant({ ...mutation(state, CAPABILITIES.EVENTS_REGISTRATIONS_MANAGE,
      'admin.events.participant.cancel', registrationId, reason), registrationId, reason, expectedVersion: expectedVersion(input.expectedVersion) })
    const refundDispatch = await dispatchRefunds(state.context.caller.appId, result.refundIds || [])
    const { refundIds, ...publicResult } = result
    return { ...publicResult, refundDispatch }
  }
  async function markAbnormalParticipant(caller, input = {}) {
    const state = await contextFor(caller, input, CAPABILITIES.EVENTS_REGISTRATIONS_MANAGE)
    const registrationId = requiredId(input.registrationId, '报名')
    const reason = text(input.reason, 120, { required: true, label: '异常原因' })
    return repository.markAbnormalParticipant({ ...mutation(state, CAPABILITIES.EVENTS_REGISTRATIONS_MANAGE,
      'admin.events.participant.abnormal', registrationId, reason), registrationId, reason, expectedVersion: expectedVersion(input.expectedVersion) })
  }
  return { listEventFeedbacks, listEventHearts, getCheckinQrcode, importParticipant, cancelParticipant, markAbnormalParticipant }
}
function rating(value) {
  if (value === undefined || value === null || value === '') return null
  const number = Number(value)
  if (!Number.isInteger(number) || number < 1 || number > 5) throw new AdminError('VALIDATION_FAILED', '评分筛选无效')
  return number
}
module.exports = { createAdminEventRuntime, rating }
