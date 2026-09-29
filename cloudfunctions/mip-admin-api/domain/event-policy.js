'use strict'

const EDITABLE_EVENT_STATUSES = Object.freeze(['DRAFT', 'UNPUBLISHED', 'PUBLISHED'])
const EVENT_TRANSITIONS = Object.freeze({
  DRAFT: ['PUBLISHED', 'CANCELLED'], PUBLISHED: ['UNPUBLISHED', 'CANCELLED', 'ENDED'],
  UNPUBLISHED: ['PUBLISHED', 'CANCELLED'], CANCELLED: [], ENDED: [], ARCHIVED: [],
})
const PUBLISHED_LOCKED_FIELDS = Object.freeze(['scopeType', 'branchId', 'eventMode', 'accessType', 'registrationPolicy'])

function eventOperationPolicy(event, can) {
  const actions = []
  if (can('events.write')) {
    actions.push('mip.admin.events.clone', 'mip.admin.events.tags.replace', 'mip.admin.events.checkinQrcode.get')
    if (EDITABLE_EVENT_STATUSES.includes(event.status)) actions.push('mip.admin.events.save')
    if (EVENT_TRANSITIONS[event.status]?.length) actions.push('mip.admin.events.changeStatus')
    if (event.status === 'DRAFT') actions.push('mip.admin.events.archive')
  }
  if (event.status === 'PUBLISHED' && can('events.registrations.manage')) actions.push('mip.admin.events.participants.import')
  if (event.status === 'PUBLISHED' && can('communications.publish')) actions.push('mip.admin.communications.publishEventReminder')
  return { availableActions: actions, allowedStatuses: EVENT_TRANSITIONS[event.status] || [],
    readOnlyFields: event.status === 'PUBLISHED' ? PUBLISHED_LOCKED_FIELDS : [] }
}

module.exports = { EDITABLE_EVENT_STATUSES, EVENT_TRANSITIONS, eventOperationPolicy }
