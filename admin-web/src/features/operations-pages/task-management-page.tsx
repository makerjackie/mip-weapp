import { Button } from 'antd'
import { PlusOutlined } from '@ant-design/icons'
import { useNavigate } from '@tanstack/react-router'
import { getAdminReadRouteDefinition } from '../../modules/admin-read-pages'
import { OperationsReadPage } from './operations-read-page'
import type { OperationsPageState } from './types'

export function TaskManagementPage(props: OperationsPageState) {
  const definition = getAdminReadRouteDefinition('tasks')
  const navigate = useNavigate()
  return (
    <OperationsReadPage
      {...props}
      title="任务管理"
      description="管理任务内容、成员分配和完成记录"
      searchPlaceholder={definition.searchPlaceholder}
      statusOptions={definition.statusOptions}
      paginated={definition.paginated}
      detailRouteForSection={(_, index) => index === 0 ? 'tasks' : 'taskCompletions'}
      actions={props.onWrite ? (
        <Button type="primary" icon={<PlusOutlined />} onClick={() => void navigate({ to: '/tasks/$taskId/edit' as never, params: { taskId: 'new' } as never })}>创建任务</Button>
      ) : null}
    />
  )
}
