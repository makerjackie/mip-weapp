'use strict'

const { defineManifest, serviceOperation } = require('./manifest')

module.exports = defineManifest('MEMBERSHIPS', [
  serviceOperation('mip.admin.memberships.get', 'QUERY', 'getMembership'),
  serviceOperation('mip.admin.memberships.grant', 'MUTATION', 'grantMembership', { wakesOutbox: true }),
])
