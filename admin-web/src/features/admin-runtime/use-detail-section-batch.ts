import { App } from 'antd'
import { useAdminSession } from '../../app/session-provider'
import type { AdminDetailSection } from '../../modules/admin-details'
import { batchExtraFields, batchSummaryMessage, executeBatchAction } from '../../modules/admin-batch-operations'
import { eventMutationConfig } from '../../modules/admin-event-mutation-forms'
import type { AdminOperationRow } from '../../modules/admin-row-operations'
import type { OperationValues } from '../../modules/admin-operation-ui'
import type { BatchAction } from '../../shared/ui/batch-actions'

/** Preserve the same reviewed registration batch operations in drawers and full detail pages. */
export function useDetailSectionBatch(refresh: () => Promise<unknown>) {
  const { message } = App.useApp()
  const { demoMode, hasCapability, request } = useAdminSession()
  const batchActionsForSection = (section: AdminDetailSection): readonly BatchAction[] => {
    const action = 'mip.admin.events.registrations.review'
    if (demoMode || !hasCapability('events.registrations.manage') || !section.rows?.some(row => row.rowActions?.some(item => item.action === action))) return []
    return [{ key: action, label: '批量审核报名', fields: batchExtraFields(eventMutationConfig(action).fields) }]
  }
  const onSectionBatchAction = async (_section: AdminDetailSection, action: BatchAction, rows: AdminOperationRow[], values: OperationValues) => {
    if (demoMode) { void message.info('演示模式不会提交写操作'); return }
    const summary = await executeBatchAction(action.key, rows, values, (operationAction, input) => request(operationAction, input))
    await refresh()
    const notice = batchSummaryMessage(summary)
    if (notice.type === 'success') void message.success(notice.text)
    else void message.warning(notice.text)
  }
  return { batchActionsForSection, onSectionBatchAction }
}
