'use strict'

const { AdminError } = require('./validation')

function notImplemented(message) {
  return async () => {
    throw new AdminError('NOT_IMPLEMENTED', message, true)
  }
}

function createCards() {
  return {
    listCards: async () => ({ items: [], cursor: null }),
    saveCard: notImplemented('保存卡片功能尚未实现'),
    changeCardStatus: notImplemented('更改卡片状态功能尚未实现'),
    takedownCard: notImplemented('下架卡片功能尚未实现'),
    listCardHistory: async () => ({ items: [], cursor: null }),
  }
}

module.exports = { createCards }
