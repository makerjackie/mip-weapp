'use strict'

const { CAPABILITIES, firstGrant } = require('./capabilities')
const { AdminError, requiredId, stableKey } = require('./validation')

function createEventDrafts({ access, repository }) {
  async function saveEventDraft(caller, input = {}) {
    const context = await access.session(caller)
    const eventId = input.eventId ? requiredId(input.eventId, '活动') : null
    const draftId = input.draftId ? requiredId(input.draftId, '草稿') : null
    const eventAuthorization = eventId
      ? await access.eventAuthorization(context, eventId, CAPABILITIES.EVENTS_WRITE) : null
    const grant = eventAuthorization?.grant || firstGrant(context.bindings, CAPABILITIES.EVENTS_WRITE)
    const draftData = input.draftData
    if (!draftData || typeof draftData !== 'object' || Array.isArray(draftData)
      || Object.getPrototypeOf(draftData) !== Object.prototype) {
      throw new AdminError('VALIDATION_FAILED', '草稿内容无效')
    }
    const dataJson = JSON.stringify(draftData)
    if (Buffer.byteLength(dataJson, 'utf8') > 64 * 1024) throw new AdminError('VALIDATION_FAILED', '草稿内容过大')
    return repository.saveEventDraft({ appId: context.caller.appId, actorUserId: context.caller.userId,
      eventId, draftId, dataJson,
      authorizedScope: eventAuthorization?.scope || null,
      idempotencyKey: stableKey(input.idempotencyKey, '请求', 128),
      authorization: access.mutationAuthorization(grant, CAPABILITIES.EVENTS_WRITE),
      audit: id => access.audit(context, grant, { scopeType: eventId ? 'EVENT' : grant.scopeType,
        scopeId: eventId || grant.scopeId, action: 'admin.events.draft.save',
        resourceType: 'EVENT_DRAFT', resourceId: id }),
    })
  }
  async function getEventDraft(caller) {
    const context = await access.session(caller)
    firstGrant(context.bindings, CAPABILITIES.EVENTS_WRITE)
    const draft = await repository.getEventDraft(context.caller.appId, context.caller.userId)
    if (draft?.eventId) await access.eventAuthorization(context, draft.eventId, CAPABILITIES.EVENTS_READ)
    return draft
  }
  return { saveEventDraft, getEventDraft }
}

module.exports = { createEventDrafts }
