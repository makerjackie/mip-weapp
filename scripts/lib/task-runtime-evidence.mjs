export function runtimeTaskItems(pageData) {
  if (Array.isArray(pageData?.tasks)) {
    return pageData.tasks
  }
  if (Array.isArray(pageData?.allTasks)) {
    return pageData.allTasks
  }
  return []
}

export function taskRuntimeEvidenceSummary(pageData) {
  const tasks = runtimeTaskItems(pageData)
  return {
    taskCount: tasks.length,
    pendingTasks: tasks.filter(task => task?.status === 'AVAILABLE').length,
  }
}
