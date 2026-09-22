'use strict'

const { defineManifest, serviceOperation } = require('./manifest')

module.exports = defineManifest('ADMIN_ACCOUNTS', [
  serviceOperation('mip.admin.adminAccounts.list', 'QUERY', 'listAdminAccounts', { sessionFirst: true }),
  serviceOperation('mip.admin.adminAccounts.create', 'MUTATION', 'createAdminAccount', { sessionFirst: true }),
  serviceOperation('mip.admin.adminAccounts.update', 'MUTATION', 'updateAdminAccount', { sessionFirst: true }),
  serviceOperation('mip.admin.adminAccounts.changeStatus', 'MUTATION', 'changeAdminAccountStatus', { sessionFirst: true }),
  serviceOperation('mip.admin.adminAccounts.resetCredential', 'MUTATION', 'resetAdminCredential', { sessionFirst: true }),
  serviceOperation('mip.admin.adminAccounts.loginRecords', 'QUERY', 'listLoginRecords', { sessionFirst: true }),
  serviceOperation('mip.admin.adminAccounts.passwordLogin', 'MUTATION', 'passwordLogin', { sessionFirst: true }),
])
