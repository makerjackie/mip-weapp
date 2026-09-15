import { Alert, Button, Checkbox, DatePicker, Form, Input, InputNumber, Modal, Select, Space, type FormInstance } from 'antd'
import dayjs from 'dayjs'
import { useState } from 'react'
import { operationFieldVisible, type OperationField, type OperationValues } from '../../modules/admin-operation-ui'
import { OVERLAY_Z_INDEX } from './overlay-z-index'

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
  if (field.kind === 'registration-schema') return <RegistrationSchemaEditor />
  return <Input maxLength={field.maxLength} type={field.kind === 'url' ? 'url' : 'text'} />
}

type RegistrationField = { key: string; label: string; type: 'TEXT' | 'TEXTAREA' | 'SELECT' | 'BOOLEAN'; required: boolean; options?: string[]; maxLength?: number }
const registrationTypes = [
  { value: 'TEXT', label: '单行文字' }, { value: 'TEXTAREA', label: '多行文字' },
  { value: 'SELECT', label: '单选' }, { value: 'BOOLEAN', label: '勾选' },
] as const

function RegistrationSchemaEditor({ value = [], onChange }: { value?: RegistrationField[]; onChange?: (value: RegistrationField[]) => void }) {
  const fields = Array.isArray(value) ? value : []
  const [optionDrafts, setOptionDrafts] = useState<Record<string, string>>({})
  const update = (index: number, patch: Partial<RegistrationField>) => onChange?.(fields.map((field, i) => i === index ? { ...field, ...patch } : field))
  const parseOptions = (raw: string) => raw.split(/[,，]/).map(item => item.trim()).filter(Boolean)
  const nextKey = () => `field_${crypto.randomUUID().replaceAll('-', '')}`
  return <Space orientation="vertical" size={8} style={{ width: '100%' }}>
    {fields.map((field, index) => <Space key={field.key || `registration-field-${index}`} wrap style={{ width: '100%' }}>
      <Input aria-label={`字段 ${index + 1} 名称`} placeholder="展示名称" maxLength={60} value={field.label} onChange={event => update(index, { label: event.target.value })} />
      <Select aria-label={`字段 ${index + 1} 类型`} style={{ width: 120 }} options={[...registrationTypes]} value={field.type} onChange={type => update(index, { type })} />
      <Checkbox checked={field.required} onChange={event => update(index, { required: event.target.checked })}>必填</Checkbox>
      {field.type === 'SELECT' ? <Input aria-label={`字段 ${index + 1} 选项`} placeholder="选项用逗号分隔" value={optionDrafts[field.key] ?? (field.options || []).join(',')} onChange={event => { const raw = event.target.value; setOptionDrafts(drafts => ({ ...drafts, [field.key]: raw })); update(index, { options: parseOptions(raw) }) }} /> : null}
      {field.type === 'TEXT' || field.type === 'TEXTAREA' ? <InputNumber aria-label={`字段 ${index + 1} 最大长度`} min={1} max={field.type === 'TEXT' ? 200 : 1000} placeholder="最大长度" value={field.maxLength} onChange={maxLength => update(index, { maxLength: maxLength || undefined })} /> : null}
      <Button danger onClick={() => onChange?.(fields.filter((_, i) => i !== index))}>删除</Button>
    </Space>)}
    <Button type="dashed" disabled={fields.length >= 12} onClick={() => onChange?.([...fields, { key: nextKey(), label: '', type: 'TEXT', required: false }])}>添加报名字段</Button>
  </Space>
}

function OperationFields({ fields, form, prefix = [] }: { fields: readonly OperationField[]; form: FormInstance<OperationValues>; prefix?: string[] }) {
  const watchedValues = Form.useWatch([], form) || form.getFieldsValue(true)
  return fields.filter(field => !field.hidden && operationFieldVisible(field, watchedValues)).map((field) => {
    const name = fieldName(field)
    if (!name) return null
    const path = [...prefix, name]
    if (field.kind === 'group') {
      return (
        <fieldset className="mutation-fieldset" key={name}>
          <legend>{field.label}</legend>
          <OperationFields fields={field.fields || []} form={form} prefix={path} />
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
      afterOpenChange={(next) => { if (next) form.setFieldsValue(formValues(fields, values)) }}
    >
      <p className="mutation-description">{description}</p>
      <Form form={form} layout="vertical" initialValues={formValues(fields, values)} disabled={loading}>
        <div className="mutation-grid"><OperationFields fields={fields} form={form} /></div>
      </Form>
      {error ? <Alert type="error" showIcon title={error} description="请求结果不确定时，请先刷新并核对服务端记录。" /> : null}
    </Modal>
  )
}
