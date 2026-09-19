import { Button, Checkbox, Input, InputNumber, Select, Space } from 'antd'
import { useState } from 'react'

export type RegistrationField = {
  key: string
  label: string
  type: 'TEXT' | 'TEXTAREA' | 'SELECT' | 'BOOLEAN'
  required: boolean
  options?: string[]
  maxLength?: number
}

const registrationTypes = [
  { value: 'TEXT', label: '单行文字' }, { value: 'TEXTAREA', label: '多行文字' },
  { value: 'SELECT', label: '单选' }, { value: 'BOOLEAN', label: '勾选' },
] as const

export function RegistrationSchemaEditor({ value = [], onChange }: {
  value?: RegistrationField[]
  onChange?: (value: RegistrationField[]) => void
}) {
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
