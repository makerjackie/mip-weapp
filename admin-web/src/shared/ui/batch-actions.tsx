import { Button, Form, Space } from 'antd'
import { useState } from 'react'
import type { OperationField, OperationValues } from '../../modules/admin-operation-ui'
import { ConfirmDialog } from './confirm-dialog'
import { OperationFields, toFormValues } from './operation-fields'

export interface BatchAction {
  key: string
  label: string
  danger?: boolean
  confirmTitle?: string
  confirmDescription?: string
  /**
   * Optional form collected once for the whole batch and merged on top of each
   * row's own operation values (e.g. a shared reason or review decision).
   */
  fields?: readonly OperationField[]
  /** Initial values for `fields`. */
  defaultValues?: OperationValues
}

/**
 * Selection bar + confirm dialog shared by every batch surface (list tables and
 * detail drawers). It owns the pick-then-confirm interaction and the optional
 * shared form; the caller owns selection state and the actual request.
 */
export function BatchActionBar({ count, actions, onRun, onClear }: {
  count: number
  actions: readonly BatchAction[]
  onRun: (action: BatchAction, values: OperationValues) => Promise<void> | void
  onClear: () => void
}) {
  const [pending, setPending] = useState<BatchAction | null>(null)
  const [loading, setLoading] = useState(false)
  const [form] = Form.useForm<OperationValues>()

  if (!count || !actions.length) return null
  const fields = pending?.fields ?? []

  const open = (action: BatchAction) => {
    form.resetFields()
    form.setFieldsValue(toFormValues(action.fields ?? [], action.defaultValues ?? {}))
    setPending(action)
  }

  const run = async () => {
    if (!pending) return
    let values: OperationValues = {}
    if (pending.fields?.length) {
      try {
        values = await form.validateFields()
      }
      catch {
        // Ant Design shows the validation errors beside the fields.
        return
      }
    }
    setLoading(true)
    try {
      await onRun(pending, values)
      onClear()
    }
    finally {
      setLoading(false)
      setPending(null)
    }
  }

  return (
    <>
      <div className="batch-action-bar" role="toolbar" aria-label="批量操作">
        <span className="batch-action-bar__count">已选 {count} 项</span>
        <Space size={8}>
          {actions.map(action => (
            <Button key={action.key} size="small" danger={action.danger} onClick={() => open(action)}>
              {action.label}
            </Button>
          ))}
          <Button size="small" type="link" onClick={onClear}>取消选择</Button>
        </Space>
      </div>
      <ConfirmDialog
        open={Boolean(pending)}
        title={pending?.confirmTitle || pending?.label || '批量操作'}
        description={pending?.confirmDescription || `将对已选 ${count} 项执行“${pending?.label || ''}”。服务端会再次校验权限、范围和版本。`}
        confirmText={pending?.label}
        danger={pending?.danger}
        loading={loading}
        onConfirm={() => void run()}
        onCancel={() => { if (!loading) setPending(null) }}
      >
        {fields.length ? (
          <Form
            form={form}
            layout="vertical"
            disabled={loading}
            initialValues={toFormValues(fields, pending?.defaultValues ?? {})}
          >
            <div className="mutation-grid"><OperationFields fields={fields} form={form} /></div>
          </Form>
        ) : null}
      </ConfirmDialog>
    </>
  )
}
