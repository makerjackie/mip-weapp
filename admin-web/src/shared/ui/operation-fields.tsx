import { Checkbox, DatePicker, Form, Input, InputNumber, Select, type FormInstance } from 'antd'
import dayjs from 'dayjs'
import {
  DATE_KINDS,
  LINE_LIST_KINDS,
  MULTI_VALUE_KINDS,
  TEXTAREA_LIKE_KINDS,
  operationFieldName,
  operationFieldVisible,
  type OperationField,
  type OperationValues,
} from '../../modules/admin-operation-ui'
import type { AdminMediaPurpose } from '../../modules/admin-media-upload'
import { RegistrationSchemaEditor } from '../../features/shared/registration-schema-editor'
import { AssetUploader, AssetListUploader } from './asset-uploader'
import { RemoteCatalogSelect, SessionUserSelect } from './session-user-select'

export const fieldName = operationFieldName

export function controlFor(field: OperationField) {
  const options = (field.options || []).map(option => typeof option === 'string' ? { value: option, label: option } : option)
  if (field.kind === 'checkbox' || field.kind === 'boolean') return <Checkbox>{field.label}</Checkbox>
  if (field.remoteUserSearch) return <SessionUserSelect />
  if (field.optionsAction) return <RemoteCatalogSelect action={field.optionsAction} />
  if (field.kind === 'select') return <Select options={options} allowClear={!field.required} />
  if (field.kind === 'multi-select') return <Select mode="multiple" options={options} />
  if (field.assetPurpose) {
    const purpose = field.assetPurpose as AdminMediaPurpose
    if (field.kind === 'asset-list' || field.kind === 'id-list') return <AssetListUploader purpose={purpose} maxCount={12} />
    return <AssetUploader purpose={purpose} />
  }
  if (field.kind === 'textarea' || TEXTAREA_LIKE_KINDS.includes(field.kind)) {
    return <Input.TextArea rows={4} maxLength={field.maxLength} showCount={Boolean(field.maxLength)} />
  }
  if (field.kind === 'datetime' || field.kind === 'datetime-local') return <DatePicker showTime className="field-full-width" />
  if (field.kind === 'date') return <DatePicker className="field-full-width" />
  if (field.kind === 'number' || field.kind === 'integer') return <InputNumber className="field-full-width" />
  if (field.kind === 'registration-schema') return <RegistrationSchemaEditor />
  return <Input maxLength={field.maxLength} type={field.kind === 'url' ? 'url' : 'text'} />
}

export function OperationFields({ fields, form, prefix = [] }: {
  fields: readonly OperationField[]
  form: FormInstance<OperationValues>
  prefix?: string[]
}) {
  const watchedValues = Form.useWatch([], form) || form.getFieldsValue(true)
  return fields.filter(field => !field.hidden && operationFieldVisible(field, watchedValues)).map((field) => {
    const name = operationFieldName(field)
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
    const wide = field.wide || field.kind === 'registration-schema'
    return (
      <Form.Item
        className={wide ? 'mutation-field--wide' : undefined}
        key={name}
        name={path}
        label={checkbox ? undefined : field.label}
        valuePropName={checkbox ? 'checked' : 'value'}
        rules={field.required ? [{ required: true, message: `请填写${field.label}` }] : undefined}
        extra={TEXTAREA_LIKE_KINDS.includes(field.kind) ? '每行填写一项' : undefined}
      >
        {controlFor(field)}
      </Form.Item>
    )
  })
}

/** Converts server/definition values into Ant Design form values (Dayjs, joined lists). */
export function toFormValues(fields: readonly OperationField[], values: OperationValues): OperationValues {
  const output: OperationValues = { ...values }
  for (const field of fields) {
    const key = operationFieldName(field)
    if (!key || field.hidden) continue
    const value = values[key]
    if (field.kind === 'group') {
      output[key] = toFormValues(field.fields || [], value && typeof value === 'object' && !Array.isArray(value) ? value as OperationValues : {})
    }
    else if (DATE_KINDS.includes(field.kind) && typeof value === 'string' && value) output[key] = dayjs(value)
    else if (field.kind === 'asset-list' && Array.isArray(value)) {
      output[key] = value.map(item => item && typeof item === 'object' && 'assetId' in item ? String(item.assetId || '') : '').filter(Boolean).join('\n')
    }
    else if (LINE_LIST_KINDS.includes(field.kind) && Array.isArray(value)) output[key] = value.map(String).join('\n')
  }
  return output
}

export { MULTI_VALUE_KINDS }
