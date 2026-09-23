'use strict'

function createTaskService(repository, contentSafety) {
  return {
    approveSubmission: (caller, event) => repository.approveSubmission(caller, event),
    rejectSubmission: (caller, event) => repository.rejectSubmission(caller, event),
    retrySubmissionReward: (caller, event) => repository.retrySubmissionReward(caller, event),
    assignTask: (caller, event) => repository.assignTask(caller, event),
    listAssignments: (caller, event) => repository.listAssignments(caller, event),
    listTaskSubmissions: (caller, event) => repository.listCompletions(caller, event),
    getEditorOptions: caller => repository.getEditorOptions(caller),
    listTasks: (caller, event) => repository.listTasks(caller, event),
    getTask: (caller, event) => repository.getTask(caller, event),
    completeTask: (caller, event) => repository.completeTask(caller, event),
    getAdminSession: caller => repository.getAdminSession(caller),
    getAdminTask: (caller, event) => repository.getAdminTask(caller, event),
    listAdminTasks: (caller, event) => repository.listAdminTasks(caller, event),
    listEligibleLevels: caller => repository.listEligibleLevels(caller),
    listAssignableMembers: (caller, event) => repository.listAssignableMembers(caller, event),
    assignMembers: (caller, event) => repository.assignMembers(caller, event),
    revokeMembers: (caller, event) => repository.revokeMembers(caller, event),
    listCompletions: (caller, event) => repository.listCompletions(caller, event),
    getCompletion: (caller, event) => repository.getCompletion(caller, event),
    exportCompletions: (caller, event) => repository.exportCompletions(caller, event),
    async saveTask(caller, event) {
      return repository.saveTask(caller, event, () => (
        contentSafety.assertSafe(caller, [event?.task?.name, event?.task?.content, event?.task?.purpose, event?.task?.completionCriteria].filter(value => typeof value === 'string'))
      ))
    },
    async transitionTask(caller, event, targetStatus) {
      return repository.transitionTask(caller, event, targetStatus, async () => {
        if (targetStatus !== 'PUBLISHED') return
        const current = await repository.getAdminTask(caller, event)
        await contentSafety.assertSafe(caller, [current.name, current.content, current.purpose, current.completionCriteria].filter(value => typeof value === 'string'))
      })
    },
  }
}

module.exports = { createTaskService }
