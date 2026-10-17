import { Form, Select } from 'antd'
import { getAdminReadRouteDefinition, auditTypeFilterOptions } from '../../modules/admin-read-pages'
import { OperationsReadPage } from '../operations-pages/operations-read-page'
import type { OperationsPageState } from '../operations-pages/types'

/** 审计日志页：在通用读列表上叠加「类型」筛选，登录类型切换为登录记录列。 */
export function AuditLogsPage(props: OperationsPageState) {
  const type = props.query.filters?.type === 'LOGIN' || props.query.filters?.type === 'OPERATION'
    ? props.query.filters.type
    : ''
  return (
    <OperationsReadPage
      {...props}
      title="操作审计"
      description="查看后台操作与登录记录"
      searchPlaceholder="搜索操作者或业务对象"
      statusOptions={getAdminReadRouteDefinition('auditLogs').statusOptions}
      paginated
      extraFilterSlots={(
        <Form.Item label="类型">
          <Select
            aria-label="类型"
            style={{ minWidth: 140 }}
            value={type}
            options={auditTypeFilterOptions}
            onChange={next => props.onFilterChange({ ...props.query, filters: { ...props.query.filters, type: next } })}
          />
        </Form.Item>
      )}
    />
  )
}
