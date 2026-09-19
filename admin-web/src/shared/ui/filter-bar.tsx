import { ReloadOutlined, SearchOutlined } from '@ant-design/icons'
import { Button, DatePicker, Form, Input, InputNumber, Select, Space } from 'antd'
import dayjs, { type Dayjs } from 'dayjs'
import { useEffect, useRef } from 'react'

export interface FilterBarValue {
  q: string
  status: string
  filters?: Record<string, string | string[] | undefined>
}

const PAGE_SIZE_OPTIONS = [
  { value: 10, label: '10 条/页' },
  { value: 20, label: '20 条/页' },
  { value: 50, label: '50 条/页' },
  { value: 100, label: '100 条/页' },
]

export function FilterBar({
  value,
  placeholder,
  statusOptions,
  loading,
  onChange,
  onRefresh,
  extraFilterSlots,
  showTimeRange,
  showAmountRange,
  showPageSize,
  pageSize,
  onPageSizeChange,
}: {
  value: FilterBarValue
  placeholder: string
  statusOptions: Array<{ value: string; label: string }>
  loading?: boolean
  onChange: (value: FilterBarValue) => void
  onRefresh?: () => void
  extraFilterSlots?: React.ReactNode
  showTimeRange?: boolean
  showAmountRange?: boolean
  showPageSize?: boolean
  pageSize?: number
  onPageSizeChange?: (size: number) => void
}) {
  const [form] = Form.useForm<FilterBarValue>()
  const syncedValue = useRef('')
  const filters = value.filters ?? {}
  useEffect(() => {
    const signature = `${value.q}\u0000${value.status}\u0000${JSON.stringify(value.filters ?? {})}`
    if (syncedValue.current === signature) return
    syncedValue.current = signature
    form.setFieldsValue(value)
  }, [form, value])
  const hasFilter = Boolean(value.q || value.status || (value.filters && Object.values(value.filters).some(v => v)))

  function commit(nextFilters: Record<string, string | string[] | undefined>) {
    onChange({
      q: form.getFieldValue('q') || '',
      status: form.getFieldValue('status') || '',
      filters: nextFilters,
    })
  }

  function handleDateRangeChange(dates: [Dayjs | null, Dayjs | null] | null) {
    const nextFilters = { ...filters }
    if (dates && dates[0] && dates[1]) {
      nextFilters.dateRange = `${dates[0].format('YYYY-MM-DD')},${dates[1].format('YYYY-MM-DD')}`
    } else {
      delete nextFilters.dateRange
    }
    commit(nextFilters)
  }

  function parseDateRange(): [Dayjs, Dayjs] | undefined {
    const raw = typeof filters.dateRange === 'string' ? filters.dateRange : ''
    if (!raw) return undefined
    const [start, end] = raw.split(',')
    if (!start || !end) return undefined
    const startDay = dayjs(start)
    const endDay = dayjs(end)
    return startDay.isValid() && endDay.isValid() ? [startDay, endDay] : undefined
  }

  function handleAmountMinChange(val: number | null) {
    const nextFilters = { ...filters }
    if (val !== null && val !== undefined) {
      nextFilters.amountMin = String(val)
    } else {
      delete nextFilters.amountMin
    }
    commit(nextFilters)
  }

  function handleAmountMaxChange(val: number | null) {
    const nextFilters = { ...filters }
    if (val !== null && val !== undefined) {
      nextFilters.amountMax = String(val)
    } else {
      delete nextFilters.amountMax
    }
    commit(nextFilters)
  }

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
      {showTimeRange ? (
        <Form.Item className="filter-bar__date-range" label="时间范围">
          <DatePicker.RangePicker
            value={parseDateRange()}
            onChange={handleDateRangeChange}
            allowClear
          />
        </Form.Item>
      ) : null}
      {showAmountRange ? (
        <Form.Item className="filter-bar__amount-range" label="金额范围">
          <Space size={4}>
            <InputNumber
              placeholder="最小"
              min={0}
              value={typeof filters.amountMin === 'string' ? Number(filters.amountMin) : undefined}
              onChange={handleAmountMinChange}
              style={{ width: 110 }}
            />
            <span>—</span>
            <InputNumber
              placeholder="最大"
              min={0}
              value={typeof filters.amountMax === 'string' ? Number(filters.amountMax) : undefined}
              onChange={handleAmountMaxChange}
              style={{ width: 110 }}
            />
          </Space>
        </Form.Item>
      ) : null}
      {extraFilterSlots}
      <Button type="primary" htmlType="submit" loading={loading}>筛选</Button>
      {hasFilter ? (
        <Button htmlType="button" onClick={() => { form.resetFields(); onChange({ q: '', status: '', filters: {} }) }}>清除</Button>
      ) : null}
      {onRefresh ? <Button aria-label="刷新数据" icon={<ReloadOutlined />} onClick={onRefresh} /> : null}
      {showPageSize ? (
        <Form.Item className="filter-bar__page-size" label="每页">
          <Select
            value={pageSize ?? 20}
            options={PAGE_SIZE_OPTIONS}
            onChange={onPageSizeChange}
            style={{ width: 120 }}
          />
        </Form.Item>
      ) : null}
    </Form>
  )
}
