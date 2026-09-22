'use strict'

const { AdminError } = require('./validation')

function notImplemented(message) {
  return async () => {
    throw new AdminError('NOT_IMPLEMENTED', message, true)
  }
}

function createContribution() {
  return {
    listContributionRules: async () => ({ items: [], cursor: null }),
    saveContributionRule: notImplemented('保存贡献值规则功能尚未实现'),
    listContributionTransactions: async () => ({ items: [], cursor: null }),
    reverseContribution: notImplemented('贡献值冲正功能尚未实现'),
  }
}

module.exports = { createContribution }
