'use strict'

const { defineManifest, serviceOperation } = require('./manifest')

module.exports = defineManifest('EVENT_DRAFTS', [
  serviceOperation('mip.admin.events.drafts.save', 'MUTATION', 'saveEventDraft', { sessionFirst: true }),
  serviceOperation('mip.admin.events.drafts.get', 'QUERY', 'getEventDraft', { sessionFirst: true }),
])
