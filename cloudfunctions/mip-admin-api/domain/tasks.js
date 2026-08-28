'use strict'

const { CAPABILITIES, authorize } = require('./capabilities')

function createAdminTasks({ access, client } = {}) {
  if (!access || typeof access.session !== 'function' || !client || typeof client.execute !== 'function') {
    throw new Error('TASKS_ADAPTER_CONFIG_INVALID')
  }

  async function execute(caller, action, input) {
    const context = await access.session(caller)
    authorize(context.bindings, CAPABILITIES.TASKS_MANAGE, { scopeType: 'PLATFORM', scopeId: null })
    return client.execute({
      appId: context.caller.appId,
      actorUserId: context.caller.userId,
      action,
      input,
    })
  }

  return Object.freeze({
    listTasks: (caller, input) => execute(caller, 'mip.admin.tasks.list', input),
    getTask: (caller, input) => execute(caller, 'mip.admin.tasks.get', input),
    listEligibleLevels: (caller, input) => execute(caller, 'mip.admin.tasks.eligibleLevels.list', input),
    saveTask: (caller, input) => execute(caller, 'mip.admin.tasks.save', input),
    publishTask: (caller, input) => execute(caller, 'mip.admin.tasks.publish', input),
    unpublishTask: (caller, input) => execute(caller, 'mip.admin.tasks.unpublish', input),
    deleteTask: (caller, input) => execute(caller, 'mip.admin.tasks.delete', input),
    listAssignableMembers: (caller, input) => execute(caller, 'mip.admin.tasks.assignableMembers.list', input),
    assignMembers: (caller, input) => execute(caller, 'mip.admin.tasks.assignMembers', input),
    revokeMembers: (caller, input) => execute(caller, 'mip.admin.tasks.revokeMembers', input),
    listCompletions: (caller, input) => execute(caller, 'mip.admin.tasks.completions.list', input),
    getCompletion: (caller, input) => execute(caller, 'mip.admin.tasks.completions.get', input),
    exportCompletions: (caller, input) => execute(caller, 'mip.admin.tasks.completions.export', input),
  })
}

module.exports = { createAdminTasks }
