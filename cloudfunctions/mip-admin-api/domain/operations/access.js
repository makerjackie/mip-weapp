'use strict'

const { defineManifest, serviceOperation } = require('./manifest')

module.exports = defineManifest('ACCESS', [
  serviceOperation('mip.admin.session', 'QUERY', 'getSession'),
  serviceOperation('mip.admin.webLogin.confirm', 'MUTATION', 'confirmWebLogin'),
  serviceOperation('mip.admin.branches.list', 'QUERY', 'listBranches'),
  serviceOperation('mip.admin.roles.list', 'QUERY', 'listRoles'),
  serviceOperation('mip.admin.roles.candidates', 'QUERY', 'searchRoleCandidates'),
  serviceOperation('mip.admin.rolePolicies.list', 'QUERY', 'listRoleCapabilityPolicies'),
  serviceOperation('mip.admin.audit.list', 'QUERY', 'listAudit'),
  serviceOperation('mip.admin.branches.create', 'MUTATION', 'createBranch'),
  serviceOperation('mip.admin.branches.update', 'MUTATION', 'updateBranch'),
  serviceOperation('mip.admin.branches.changeStatus', 'MUTATION', 'changeBranchStatus'),
  serviceOperation('mip.admin.roles.set', 'MUTATION', 'setRole'),
  serviceOperation('mip.admin.rolePolicies.update', 'MUTATION', 'updateRoleCapabilityPolicy'),
])
