import { Alert, Form, Modal } from 'antd'
import { useId } from 'react'
import type { OperationField, OperationValues } from '../../modules/admin-operation-ui'
import { OperationFields, toFormValues } from './operation-fields'
import { OVERLAY_Z_INDEX } from './overlay-z-index'

export function MutationDialog({ open, title, description, fields, values, loading, error, onSubmit, onCancel }: {
  open: boolean
  title: string
  description: string
  fields: readonly OperationField[]
  values: OperationValues
  loading?: boolean
  error?: string
  onSubmit: (values: OperationValues) => void
  onCancel: () => void
}) {
  const [form] = Form.useForm<OperationValues>()
  const formName = useId()
  return (
    <Modal
      className="mutation-dialog"
      // Mutation dialogs can be opened from the detail Drawer. Keep this
      // layer above the Drawer portal so the form and confirmation controls
      // remain reachable.
      zIndex={OVERLAY_Z_INDEX.mutation}
      open={open}
      title={title}
      okText="确认提交"
      cancelText="取消"
      confirmLoading={loading}
      mask={{ closable: !loading }}
      keyboard={!loading}
      onCancel={onCancel}
      onOk={() => void form.validateFields().then(onSubmit, () => {
        // Ant Design displays validation errors beside the fields.
      })}
      afterOpenChange={(next) => { if (next) form.setFieldsValue(toFormValues(fields, values)) }}
    >
      <p className="mutation-description">{description}</p>
      <Form name={`mutation-${formName}`} form={form} layout="vertical" initialValues={toFormValues(fields, values)} disabled={loading}>
        <div className="mutation-grid"><OperationFields fields={fields} form={form} /></div>
      </Form>
      {error ? <Alert type="error" showIcon title={error} description="请求结果不确定时，请先刷新并核对服务端记录。" /> : null}
    </Modal>
  )
}
