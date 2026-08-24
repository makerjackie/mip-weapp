'use strict'

function createTaskService(repository, contentSafety) {
  return {
    listTasks: (caller, event) => repository.listTasks(caller, event),
    getTask: (caller, event) => repository.getTask(caller, event),
    completeTask: (caller, event) => repository.completeTask(caller, event),
    getAdminSession: caller => repository.getAdminSession(caller),
    getAdminTask: (caller, event) => repository.getAdminTask(caller, event),
    listAdminTasks: (caller, event) => repository.listAdminTasks(caller, event),
    listAssignableMembers: (caller, event) => repository.listAssignableMembers(caller, event),
    assignMembers: (caller, event) => repository.assignMembers(caller, event),
    revokeMembers: (caller, event) => repository.revokeMembers(caller, event),
    listCompletions: (caller, event) => repository.listCompletions(caller, event),
    getCompletion: (caller, event) => repository.getCompletion(caller, event),
    exportCompletions: (caller, event) => repository.exportCompletions(caller, event),
    async saveTask(caller, event) {
      await repository.getAdminSession(caller)
      await contentSafety.assertSafe(caller, [event?.task?.name, event?.task?.content])
      return repository.saveTask(caller, event)
    },
    async transitionTask(caller, event, targetStatus) {
      if (targetStatus === 'PUBLISHED') {
        const current = await repository.getAdminTask(caller, event)
        await contentSafety.assertSafe(caller, [current.name, current.content])
      }
      return repository.transitionTask(caller, event, targetStatus)
    },
  }
}

module.exports = { createTaskService }
