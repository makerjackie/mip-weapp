import { describe, expect, it } from 'vitest'
import { runtimeTaskItems, taskRuntimeEvidenceSummary } from '../scripts/lib/task-runtime-evidence.mjs'

describe('task runtime evidence', () => {
  it('counts current task page data using stable task status instead of localized copy', () => {
    const pageData = {
      tasks: [
        { id: 'task-1', status: 'AVAILABLE', statusText: '待完成' },
        { id: 'task-2', status: 'AVAILABLE', statusText: '待完成' },
        { id: 'task-3', status: 'ENDED', statusText: '已截止' },
      ],
    }

    expect(runtimeTaskItems(pageData)).toBe(pageData.tasks)
    expect(taskRuntimeEvidenceSummary(pageData)).toEqual({ taskCount: 3, pendingTasks: 2 })
  })

  it('supports the legacy allTasks carrier without preferring an empty missing field', () => {
    expect(taskRuntimeEvidenceSummary({
      allTasks: [{ id: 'task-1', status: 'AVAILABLE' }],
    })).toEqual({ taskCount: 1, pendingTasks: 1 })
    expect(taskRuntimeEvidenceSummary({})).toEqual({ taskCount: 0, pendingTasks: 0 })
  })
})
