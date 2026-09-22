'use strict'

const { AdminError } = require('./validation')

function notImplemented(message) {
  return async () => {
    throw new AdminError('NOT_IMPLEMENTED', message, true)
  }
}

function createEventDrafts() {
  return {
    saveEventDraft: notImplemented('保存活动草稿功能尚未实现'),
    getEventDraft: async () => null,
  }
}

module.exports = { createEventDrafts }
