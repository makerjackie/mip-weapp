import { Button, Form, Select, Typography } from 'antd'
import { PlusOutlined } from '@ant-design/icons'
import { useNavigate } from '@tanstack/react-router'
import { useMemo } from 'react'
import { getAdminReadRouteDefinition, type AdminReadPage } from '../../modules/admin-read-pages'
import { taskApprovalStarLabel } from '../../modules/admin-task-management'
import { OperationsReadPage } from './operations-read-page'
import type { OperationsPageState } from './types'

// MIW-130：任务列表服务端只支持关键字与状态筛选，星级/负责人/奖励在当前页行数据上过滤。
const TASK_STAR_FILTER_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: '全部星级' },
  ...[1, 2, 3, 4, 5].map(level => ({ value: String(level), label: taskApprovalStarLabel(level) })),
]

const TASK_REWARD_FILTER_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: '全部奖励' },
  { value: 'experience', label: '经验值' },
  { value: 'contribution', label: '贡献值' },
  { value: 'bonus', label: '奖金' },
]

const TASK_REWARD_FILTER_LABELS: Record<string, string> = {
  experience: '经验值',
  contribution: '贡献值',
  bonus: '奖金',
}

export function TaskManagementPage(props: OperationsPageState) {
  const definition = getAdminReadRouteDefinition('tasks')
  const navigate = useNavigate()
  const filters = props.query.filters || {}
  const starLevel = filters.starLevel || ''
  const assignedOwner = filters.assignedOwner || ''
  const rewardType = filters.rewardType || ''
  const page = useMemo(
    () => filterCurrentTaskRows(props.page, { starLevel, assignedOwner, rewardType }),
    [props.page, starLevel, assignedOwner, rewardType],
  )
  const ownerOptions = useMemo(() => taskOwnerOptions(props.page), [props.page])
  const changeFilter = (next: Record<string, string>) =>
    props.onFilterChange({ ...props.query, filters: next })
  return (
    <OperationsReadPage
      {...props}
      page={page}
      title="任务管理"
      description="管理任务内容、成员分配和完成记录"
      searchPlaceholder={definition.searchPlaceholder}
      statusOptions={definition.statusOptions}
      paginated={definition.paginated}
      detailRouteForSection={(_, index) => index === 0 ? 'tasks' : 'taskCompletions'}
      extraFilterSlots={<>
        <Form.Item label="星级">
          <Select
            aria-label="任务星级"
            style={{ minWidth: 130 }}
            value={starLevel}
            options={TASK_STAR_FILTER_OPTIONS}
            onChange={value => changeFilter({ ...filters, starLevel: value })}
          />
        </Form.Item>
        <Form.Item label="负责人">
          <Select
            aria-label="任务负责人"
            style={{ minWidth: 160 }}
            value={assignedOwner}
            options={ownerOptions}
            onChange={value => changeFilter({ ...filters, assignedOwner: value })}
          />
        </Form.Item>
        <Form.Item label="奖励">
          <Select
            aria-label="任务奖励类型"
            style={{ minWidth: 140 }}
            value={rewardType}
            options={TASK_REWARD_FILTER_OPTIONS}
            onChange={value => changeFilter({ ...filters, rewardType: value })}
          />
        </Form.Item>
        {starLevel || assignedOwner || rewardType ? (
          <Typography.Text type="secondary">当前页过滤</Typography.Text>
        ) : null}
      </>}
      actions={props.onWrite ? (
        <Button type="primary" icon={<PlusOutlined />} onClick={() => void navigate({ to: '/tasks/$taskId/edit' as never, params: { taskId: 'new' } as never, search: previous => ({ returnSearch: previous }) as never })}>创建任务</Button>
      ) : null}
    />
  )
}

function taskOwnerOptions(page: OperationsPageState['page']) {
  const names = new Set((page?.sections[0]?.rows ?? [])
    .map(row => String(row.assignedOwner || ''))
    .filter(name => name && name !== '—'))
  return [
    { value: '', label: '全部负责人' },
    ...Array.from(names).sort().map(name => ({ value: name, label: name })),
  ]
}

function filterCurrentTaskRows(
  page: AdminReadPage | null,
  filters: { starLevel: string; assignedOwner: string; rewardType: string },
) {
  if (!page || (!filters.starLevel && !filters.assignedOwner && !filters.rewardType)) return page
  const rewardLabel = filters.rewardType ? TASK_REWARD_FILTER_LABELS[filters.rewardType] || '' : ''
  return {
    ...page,
    sections: page.sections.map((section, index) => index === 0
      ? {
          ...section,
          rows: section.rows.filter(row =>
            (!filters.starLevel || String(row.starLevel || '') === filters.starLevel)
            && (!filters.assignedOwner || String(row.assignedOwner || '') === filters.assignedOwner)
            && (!rewardLabel || String(row.rewardConfig || '').includes(rewardLabel))),
        }
      : section),
  }
}
