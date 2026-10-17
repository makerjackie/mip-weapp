import { Form, Select } from 'antd'
import type { OperationsPageState } from './types'

export interface GrowthSectionOption {
  value: string
  label: string
}

/**
 * MIW-129：成长体系各页的「分区」下拉。数据装配复用 growth 段（filters.section），
 * 每个页面只暴露本页范围内的分区，不再提供跨页的「全部概览」。
 */
export function GrowthSectionSelect({ sections, page, state }: {
  sections: readonly GrowthSectionOption[]
  page: string
  state: OperationsPageState
}) {
  const selected = sections.some(section => section.value === state.query.filters?.section)
    ? state.query.filters?.section || ''
    : sections[0]?.value || ''
  return (
    <Form.Item label="分区">
      <Select
        aria-label={`${page}分区`}
        style={{ minWidth: 170 }}
        value={selected}
        options={sections.map(section => ({ value: section.value, label: section.label }))}
        onChange={section => state.onFilterChange({ ...state.query, filters: { ...state.query.filters, section } })}
      />
    </Form.Item>
  )
}

/** 去掉分区参数后剩余的查询条件，供导出等仅接受业务筛选的入口复用。 */
export function growthFiltersWithoutSection(state: OperationsPageState): Record<string, string> {
  return Object.fromEntries(Object.entries(state.query.filters || {}).filter(([key]) => key !== 'section'))
}
