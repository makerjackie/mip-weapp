'use strict'

const { defineManifest, serviceOperation } = require('./manifest')

module.exports = defineManifest('TASKS', [
  serviceOperation('mip.admin.tasks.list', 'QUERY', 'listTasks'),
  serviceOperation('mip.admin.tasks.get', 'QUERY', 'getTask'),
  serviceOperation('mip.admin.tasks.save', 'MUTATION', 'saveTask'),
  serviceOperation('mip.admin.tasks.publish', 'MUTATION', 'publishTask'),
  serviceOperation('mip.admin.tasks.unpublish', 'MUTATION', 'unpublishTask'),
  serviceOperation('mip.admin.tasks.delete', 'MUTATION', 'deleteTask'),
  serviceOperation('mip.admin.tasks.assignableMembers.list', 'QUERY', 'listAssignableMembers'),
  serviceOperation('mip.admin.tasks.assignMembers', 'MUTATION', 'assignMembers'),
  serviceOperation('mip.admin.tasks.revokeMembers', 'MUTATION', 'revokeMembers'),
  serviceOperation('mip.admin.tasks.completions.list', 'QUERY', 'listCompletions'),
  serviceOperation('mip.admin.tasks.completions.get', 'QUERY', 'getCompletion'),
  serviceOperation('mip.admin.tasks.completions.export', 'QUERY', 'exportCompletions'),
])
