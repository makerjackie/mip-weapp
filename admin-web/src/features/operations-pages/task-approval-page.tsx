import { Form, Select } from 'antd'
import { useQuery } from '@tanstack/react-query'
import { useAdminSession } from '../../app/session-provider'
import type { AdminListQuery, AdminReadPage, AdminTableRow } from '../../modules/admin-read-pages'
import {
  buildTaskApprovalPage,
  loadTaskApprovalPage,
  taskApprovalStarLabel,
  TASK_APPROVAL_STATUS_OPTIONS,
  TASK_WORKFLOW_MODE_OPTIONS,
} from '../../modules/admin-task-management'
import { demo } from '../../services/demo-data'
import { OperationsReadPage } from './operations-read-page'
import type { OperationsPageState } from './types'

const TASK_APPROVAL_STAR_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: '全部星级' },
  ...[1, 2, 3, 4, 5].map(level => ({ value: String(level), label: taskApprovalStarLabel(level) })),
]

export function TaskApprovalPage(props: OperationsPageState) {
  const starLevel = props.query.filters?.starLevel || ''
  return (
    <OperationsReadPage
      {...props}
      title="NPC任务"
      description="提交与审批记录；历史直接完成记录保留可查"
      searchPlaceholder="搜索提交人或任务"
      statusOptions={TASK_APPROVAL_STATUS_OPTIONS}
      paginated
      extraFilterSlots={<>
        <Form.Item label="星级">
          <Select
            aria-label="审批星级"
            style={{ minWidth: 140 }}
            value={starLevel}
            options={TASK_APPROVAL_STAR_OPTIONS}
            onChange={value => props.onFilterChange({ ...props.query, filters: { ...props.query.filters, starLevel: value } })}
          />
        </Form.Item>
        <Form.Item label="执行方式">
          <Select aria-label="记录执行方式" style={{ minWidth: 150 }} value={props.query.filters?.workflowMode || ''}
            options={TASK_WORKFLOW_MODE_OPTIONS}
            onChange={value => props.onFilterChange({ ...props.query, filters: { ...props.query.filters, workflowMode: value } })} />
        </Form.Item>
      </>}
    />
  )
}

export function useTaskApprovalPage(query: AdminListQuery) {
  const session = useAdminSession()
  const enabled = session.demoMode || Boolean(session.session?.enabled)
  const result = useQuery({
    queryKey: ['admin', 'task-approval-page', session.session?.actor?.id || 'anonymous', session.sessionBoundary, session.demoMode ? 'demo' : 'api', query],
    enabled,
    queryFn: () => session.demoMode
      ? Promise.resolve(createTaskApprovalDemoPage(query))
      : loadTaskApprovalPage(query, session.request),
  })
  return {
    ...result,
    loading: session.loading || (enabled && result.isPending),
    refreshing: enabled && result.isFetching && !result.isPending,
    errorMessage: errorMessage(result.error || session.error),
  }
}

function createTaskApprovalDemoPage(query: AdminListQuery): AdminReadPage {
  const items = demo.taskApprovals
    .filter(item => !query.status || String(item.submissionStatus || '') === query.status)
    .filter(item => !query.filters?.starLevel || String(item.starLevel) === query.filters.starLevel)
    .filter(item => !query.filters?.workflowMode || item.workflowMode === query.filters.workflowMode)
    .map(item => ({ ...item }) as AdminTableRow)
  return buildTaskApprovalPage(items, null)
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : ''
}
