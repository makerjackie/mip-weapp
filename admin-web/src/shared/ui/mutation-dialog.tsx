import { Alert, Checkbox, DatePicker, Form, Input, InputNumber, Modal, Select } from 'antd'
import dayjs from 'dayjs'
import type { OperationField, OperationValues } from '../../modules/admin-operation-ui'

function fieldName(field: OperationField) { return String(field.name || field.key || '') }

function controlFor(field: OperationField) {
  const options = (field.options || []).map(option => typeof option === 'string' ? { value: option, label: option } : option)
  if (field.kind === 'checkbox' || field.kind === 'boolean') return <Checkbox />
  if (field.kind === 'select') return <Select options={options} allowClear={!field.required} />
  if (field.kind === 'multi-select') return <Select mode="multiple" options={options} />
  if (field.kind === 'textarea' || ['asset-list', 'id-list', 'profile-ref-list', 'tags'].includes(field.kind)) {
    return <Input.TextArea rows={4} maxLength={field.maxLength} showCount={Boolean(field.maxLength)} />
  }
  if (field.kind === 'datetime' || field.kind === 'datetime-local') return <DatePicker showTime className="field-full-width" />
  if (field.kind === 'date') return <DatePicker className="field-full-width" />
  if (field.kind === 'number' || field.kind === 'integer') return <InputNumber className="field-full-width" />
  return <Input maxLength={field.maxLength} type={field.kind === 'url' ? 'url' : 'text'} />
}

function OperationFields({ fields, prefix = [] }: { fields: readonly OperationField[]; prefix?: string[] }) {
  return fields.filter(field => !field.hidden).map((field) => {
    const name = fieldName(field)
    if (!name) return null
    const path = [...prefix, name]
    if (field.kind === 'group') {
      return (
        <fieldset className="mutation-fieldset" key={name}>
          <legend>{field.label}</legend>
          <OperationFields fields={field.fields || []} prefix={path} />
        </fieldset>
      )
    }
    const checkbox = field.kind === 'checkbox' || field.kind === 'boolean'
    return (
      <Form.Item
        className={field.wide ? 'mutation-field--wide' : undefined}
        key={name}
        name={path}
        label={checkbox ? undefined : field.label}
        valuePropName={checkbox ? 'checked' : 'value'}
        rules={field.required ? [{ required: true, message: `请填写${field.label}` }] : undefined}
        extra={['asset-list', 'id-list', 'profile-ref-list', 'tags'].includes(field.kind) ? '每行填写一项' : undefined}
      >
        {checkbox ? <Checkbox>{field.label}</Checkbox> : controlFor(field)}
      </Form.Item>
    )
  })
}

function formValues(fields: readonly OperationField[], values: OperationValues): OperationValues {
  const output: OperationValues = { ...values }
  for (const field of fields) {
    const key = fieldName(field)
    if (!key || field.hidden) continue
    const value = values[key]
    if (field.kind === 'group') output[key] = formValues(field.fields || [], value && typeof value === 'object' && !Array.isArray(value) ? value as OperationValues : {})
    else if (['datetime', 'datetime-local', 'date'].includes(field.kind) && typeof value === 'string' && value) output[key] = dayjs(value)
    else if (field.kind === 'asset-list' && Array.isArray(value)) output[key] = value.map(item => item && typeof item === 'object' && 'assetId' in item ? String(item.assetId || '') : '').filter(Boolean).join('\n')
    else if (['id-list', 'profile-ref-list', 'tags'].includes(field.kind) && Array.isArray(value)) output[key] = value.map(String).join('\n')
  }
  return output
}

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
  return (
    <Modal
      className="mutation-dialog"
      open={open}
      title={title}
      okText="确认提交"
      cancelText="取消"
      confirmLoading={loading}
      maskClosable={!loading}
      keyboard={!loading}
      onCancel={onCancel}
      onOk={() => void form.validateFields().then(onSubmit)}
      afterOpenChange={(next) => { if (next) form.setFieldsValue(formValues(fields, values)) }}
    >
      <p className="mutation-description">{description}</p>
      <Form form={form} layout="vertical" initialValues={formValues(fields, values)} disabled={loading}>
        <div className="mutation-grid"><OperationFields fields={fields} /></div>
      </Form>
      {error ? <Alert type="error" showIcon message={error} description="请求结果不确定时，请先刷新并核对服务端记录。" /> : null}
    </Modal>
  )
}
