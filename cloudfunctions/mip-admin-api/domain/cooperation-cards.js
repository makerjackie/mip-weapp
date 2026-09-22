'use strict'

const { AdminError } = require('./validation')

function notImplemented(message) {
  return async () => {
    throw new AdminError('NOT_IMPLEMENTED', message, true)
  }
}

function createCooperationCards() {
  return {
    getCooperationCard: async () => null,
    saveCooperationCard: notImplemented('保存合作卡功能尚未实现'),
  }
}

module.exports = { createCooperationCards }
