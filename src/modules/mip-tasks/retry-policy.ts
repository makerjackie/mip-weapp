const retryableTaskActions = new Set([
  'listTasks',
  'getTask',
  'completeTask',
  'admin.getSession',
  'admin.getTask',
  'admin.listTasks',
  'admin.listAssignableMembers',
  'admin.listCompletions',
  'admin.getCompletion',
  'admin.exportCompletions',
])

export function isRetryableTaskAction(action: string) {
  return retryableTaskActions.has(action)
}
