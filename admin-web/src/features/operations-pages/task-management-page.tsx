import { Button, Form, Select } from 'antd'
import { PlusOutlined } from '@ant-design/icons'
import { useNavigate } from '@tanstack/react-router'
import { getAdminReadRouteDefinition } from '../../modules/admin-read-pages'
import { taskApprovalStarLabel, TASK_WORKFLOW_MODE_OPTIONS } from '../../modules/admin-task-management'
import { OperationsReadPage } from './operations-read-page'
import type { OperationsPageState } from './types'

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

export function TaskManagementPage(props: OperationsPageState) {
  const definition = getAdminReadRouteDefinition('tasks')
  const navigate = useNavigate()
  const filters = props.query.filters || {}
  const starLevel = filters.starLevel || ''
  const assignedOwnerId = filters.assignedOwnerId || ''
  const rewardType = filters.rewardType || ''
  const ownerOptions = [{ value: '', label: '全部负责人' }, ...(props.page?.filterOptions?.assignedOwnerId || [])]
  const changeFilter = (next: Record<string, string>) =>
    props.onFilterChange({ ...props.query, filters: next })
  return (
    <OperationsReadPage
      {...props}
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
            value={assignedOwnerId}
            options={ownerOptions}
            onChange={value => changeFilter({ ...filters, assignedOwnerId: value })}
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
        <Form.Item label="执行方式">
          <Select aria-label="任务执行方式" style={{ minWidth: 150 }} value={filters.workflowMode || ''}
            options={TASK_WORKFLOW_MODE_OPTIONS}
            onChange={value => changeFilter({ ...filters, workflowMode: value })} />
        </Form.Item>
      </>}
      actions={props.onWrite ? (
        <Button type="primary" icon={<PlusOutlined />} onClick={() => void navigate({ to: '/tasks/$taskId/edit' as never, params: { taskId: 'new' } as never, search: previous => ({ returnSearch: previous }) as never })}>创建任务</Button>
      ) : null}
    />
  )
}
