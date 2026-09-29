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

export interface FilterFieldRange {
  from: string
  to: string
  label?: string
}

export interface FilterFieldAmount {
  min: string
  max: string
  label?: string
  scale?: number
}

export function FilterBar({
  value,
  placeholder,
  statusOptions,
  loading,
  onChange,
  onRefresh,
  extraFilterSlots,
  timeRangeFields,
  amountRangeFields,
  showPageSize,
  pageSize,
  onPageSizeChange,
  dimensionField,
  dimensionLabel,
  dimensionOptions,
}: {
  value: FilterBarValue
  placeholder: string
  statusOptions: Array<{ value: string; label: string }>
  loading?: boolean
  onChange: (value: FilterBarValue) => void
  onRefresh?: () => void
  extraFilterSlots?: React.ReactNode
  timeRangeFields?: FilterFieldRange
  amountRangeFields?: FilterFieldAmount
  showPageSize?: boolean
  pageSize?: number
  onPageSizeChange?: (size: number) => void
  dimensionField?: string
  dimensionLabel?: string
  dimensionOptions?: Array<{ value: string; label: string }>
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

  function activeFilters(source: Record<string, string | string[] | undefined>): Record<string, string> {
    const active: Record<string, string> = {}
    for (const [key, val] of Object.entries(source)) {
      if (typeof val === 'string' && val.length > 0) active[key] = val
    }
    return active
  }

  function commit(nextFilters: Record<string, string | string[] | undefined>) {
    const active = activeFilters(nextFilters)
    onChange({
      q: form.getFieldValue('q') || '',
      status: form.getFieldValue('status') || '',
      ...(Object.keys(active).length > 0 ? { filters: active } : {}),
    })
  }

  function commitFromForm() {
    commit(filters)
  }

  function submitNow() {
    form.validateFields().then(commitFromForm, () => {})
  }

  function handleDateRangeChange(dates: [Dayjs | null, Dayjs | null] | null) {
    if (!timeRangeFields) return
    const nextFilters = { ...filters }
    if (dates && dates[0] && dates[1]) {
      nextFilters[timeRangeFields.from] = dates[0].startOf('day').toISOString()
      nextFilters[timeRangeFields.to] = dates[1].endOf('day').toISOString()
    } else {
      delete nextFilters[timeRangeFields.from]
      delete nextFilters[timeRangeFields.to]
    }
    commit(nextFilters)
  }

  function parseDateRange(): [Dayjs, Dayjs] | undefined {
    if (!timeRangeFields) return undefined
    const fromRaw = typeof filters[timeRangeFields.from] === 'string' ? filters[timeRangeFields.from] as string : ''
    const toRaw = typeof filters[timeRangeFields.to] === 'string' ? filters[timeRangeFields.to] as string : ''
    if (!fromRaw || !toRaw) return undefined
    const startDay = dayjs(fromRaw)
    const endDay = dayjs(toRaw)
    return startDay.isValid() && endDay.isValid() ? [startDay, endDay] : undefined
  }

  function amountToYuan(key: string): number | undefined {
    const raw = typeof filters[key] === 'string' ? filters[key] as string : ''
    if (!raw) return undefined
    const cents = Number(raw)
    return Number.isFinite(cents) ? cents / (amountRangeFields?.scale ?? 100) : undefined
  }

  function handleAmountChange(key: string, val: number | null) {
    if (!amountRangeFields) return
    const nextFilters = { ...filters }
    if (val !== null && val !== undefined) {
      nextFilters[key] = String(Math.round(val * (amountRangeFields.scale ?? 100)))
    } else {
      delete nextFilters[key]
    }
    commit(nextFilters)
  }

  function handleDimensionsChange(value: string) {
    if (!dimensionField) return
    const nextFilters = { ...filters }
    if (value) nextFilters[dimensionField] = value
    else delete nextFilters[dimensionField]
    commit(nextFilters)
  }

  function parseDimensions(): string {
    if (!dimensionField) return ''
    return typeof filters[dimensionField] === 'string' ? filters[dimensionField] as string : ''
  }

  function handleSubmit() {
    commitFromForm()
  }

  return (
    <Form
      form={form}
      className="filter-bar"
      layout="inline"
      initialValues={value}
      onFinish={handleSubmit}
      aria-label="列表筛选"
    >
      <Form.Item name="q" className="filter-bar__search">
        <Input
          allowClear
          prefix={<SearchOutlined />}
          placeholder={placeholder}
          maxLength={80}
          onPressEnter={submitNow}
        />
      </Form.Item>
      <Form.Item name="status" className="filter-bar__status">
        <Select
          options={statusOptions}
          onChange={submitNow}
        />
      </Form.Item>
      {dimensionField && dimensionOptions && dimensionOptions.length ? (
        <Form.Item className="filter-bar__dimensions" label={dimensionLabel || '分类'}>
          <Select
            placeholder={dimensionLabel ? `选择${dimensionLabel}` : '分类筛选'}
            options={dimensionOptions}
            value={parseDimensions() || undefined}
            onChange={handleDimensionsChange}
            allowClear
            style={{ minWidth: 180 }}
          />
        </Form.Item>
      ) : null}
      {timeRangeFields ? (
        <Form.Item className="filter-bar__date-range" label={timeRangeFields.label || '时间范围'}>
          <DatePicker.RangePicker
            value={parseDateRange()}
            onChange={handleDateRangeChange}
            allowClear
          />
        </Form.Item>
      ) : null}
      {amountRangeFields ? (
        <Form.Item className="filter-bar__amount-range" label={amountRangeFields.label || '金额范围'}>
          <Space size={4}>
            <InputNumber
              placeholder="最小"
              min={0}
              value={amountToYuan(amountRangeFields.min)}
              onChange={val => handleAmountChange(amountRangeFields.min, val)}
              style={{ width: 110 }}
            />
            <span>—</span>
            <InputNumber
              placeholder="最大"
              min={0}
              value={amountToYuan(amountRangeFields.max)}
              onChange={val => handleAmountChange(amountRangeFields.max, val)}
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
