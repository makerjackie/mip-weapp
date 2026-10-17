import { Form, Select, Typography } from 'antd'
import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { useAdminSession } from '../../app/session-provider'
import type { AdminListQuery, AdminReadPage, AdminTableRow } from '../../modules/admin-read-pages'
import {
  buildTaskApprovalPage,
  loadTaskApprovalPage,
  taskApprovalStarLabel,
  TASK_APPROVAL_STATUS_OPTIONS,
} from '../../modules/admin-task-management'
import { demo } from '../../services/demo-data'
import { OperationsReadPage } from './operations-read-page'
import type { OperationsPageState } from './types'

// MIW-130：星级筛选服务端未提供查询参数，仅对当前页行数据过滤，需要配合「当前页过滤」提示。
const TASK_APPROVAL_STAR_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: '全部星级' },
  ...[1, 2, 3, 4, 5].map(level => ({ value: String(level), label: taskApprovalStarLabel(level) })),
]

export function TaskApprovalPage(props: OperationsPageState) {
  const starLevel = props.query.filters?.starLevel || ''
  const page = useMemo(
    () => filterCurrentApprovalRows(props.page, starLevel),
    [props.page, starLevel],
  )
  return (
    <OperationsReadPage
      {...props}
      page={page}
      title="NPC任务"
      description="提交与审批记录"
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
        {starLevel ? <Typography.Text type="secondary">当前页过滤</Typography.Text> : null}
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
    .map(item => ({ ...item }) as AdminTableRow)
  return buildTaskApprovalPage(items, null)
}

function filterCurrentApprovalRows(page: AdminReadPage | null, starLevel: string) {
  if (!page || !starLevel) return page
  const expected = taskApprovalStarLabel(starLevel)
  return {
    ...page,
    sections: page.sections.map(section => ({
      ...section,
      rows: section.rows.filter(row => row.starLevel === expected),
    })),
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : ''
}
