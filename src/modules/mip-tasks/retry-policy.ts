const retryableTaskActions = new Set([
  'listTasks',
  'getTask',
  'admin.getSession',
  'admin.getTask',
  'admin.listTasks',
  'admin.listEligibleLevels',
  'admin.listAssignableMembers',
  'admin.listCompletions',
  'admin.getCompletion',
  'admin.exportCompletions',
])

export function isRetryableTaskAction(action: string) {
  return retryableTaskActions.has(action)
}
