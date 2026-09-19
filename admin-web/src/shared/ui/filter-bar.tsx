import { ReloadOutlined, SearchOutlined } from '@ant-design/icons'
import { Button, Form, Input, Select } from 'antd'
import { useEffect, useRef } from 'react'

export interface FilterBarValue { q: string; status: string }

export function FilterBar({ value, placeholder, statusOptions, loading, onChange, onRefresh }: {
  value: FilterBarValue
  placeholder: string
  statusOptions: Array<{ value: string; label: string }>
  loading?: boolean
  onChange: (value: FilterBarValue) => void
  onRefresh?: () => void
}) {
  const [form] = Form.useForm<FilterBarValue>()
  const syncedValue = useRef('')
  useEffect(() => {
    const signature = `${value.q}\u0000${value.status}`
    if (syncedValue.current === signature) return
    syncedValue.current = signature
    form.setFieldsValue(value)
  }, [form, value])
  const hasFilter = Boolean(value.q || value.status)
  return (
    <Form
      form={form}
      className="filter-bar"
      layout="inline"
      initialValues={value}
      onFinish={onChange}
      aria-label="列表筛选"
    >
      <Form.Item name="q" className="filter-bar__search">
        <Input
          allowClear
          prefix={<SearchOutlined />}
          placeholder={placeholder}
          maxLength={80}
          onPressEnter={() => form.validateFields().then(onChange, () => {})}
        />
      </Form.Item>
      <Form.Item name="status" className="filter-bar__status">
        <Select
          options={statusOptions}
          onChange={() => form.validateFields().then(onChange, () => {})}
        />
      </Form.Item>
      <Button type="primary" htmlType="submit" loading={loading}>筛选</Button>
      {hasFilter ? (
        <Button htmlType="button" onClick={() => { form.resetFields(); onChange({ q: '', status: '' }) }}>清除</Button>
      ) : null}
      {onRefresh ? <Button aria-label="刷新数据" icon={<ReloadOutlined />} onClick={onRefresh} /> : null}
    </Form>
  )
}
