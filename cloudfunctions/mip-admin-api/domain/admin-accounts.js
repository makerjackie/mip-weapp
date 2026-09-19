'use strict'

const { AdminError } = require('./validation')

function notImplemented(message) {
  return async () => {
    throw new AdminError('NOT_IMPLEMENTED', message, true)
  }
}

function createAdminAccounts() {
  return {
    listAdminAccounts: async () => ({ items: [], cursor: null }),
    createAdminAccount: notImplemented('创建后台账号功能尚未实现'),
    updateAdminAccount: notImplemented('编辑后台账号功能尚未实现'),
    changeAdminAccountStatus: notImplemented('启用/停用后台账号功能尚未实现'),
    resetAdminCredential: notImplemented('重置后台账号凭证功能尚未实现'),
  }
}

module.exports = { createAdminAccounts }
