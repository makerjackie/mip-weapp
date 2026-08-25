'use strict'

const { defineManifest, serviceOperation } = require('./manifest')

module.exports = defineManifest('USERS', [
  serviceOperation('mip.admin.users.list', 'QUERY', 'listUsers'),
  serviceOperation('mip.admin.users.get', 'QUERY', 'getUser'),
  serviceOperation('mip.admin.communityReports.list', 'QUERY', 'listCommunityReports'),
  serviceOperation('mip.admin.users.update', 'MUTATION', 'updateUser'),
  serviceOperation('mip.admin.users.setControl', 'MUTATION', 'setUserControl'),
  serviceOperation('mip.admin.communityReports.claim', 'MUTATION', 'claimCommunityReport'),
  serviceOperation('mip.admin.communityReports.close', 'MUTATION', 'closeCommunityReport'),
])
