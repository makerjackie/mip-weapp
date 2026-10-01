import { Button, Form, Input, Select, Space } from 'antd'
import { PlusOutlined } from '@ant-design/icons'
import { useNavigate } from '@tanstack/react-router'
import { getAdminReadRouteDefinition } from '../../modules/admin-read-pages'
import { OperationsReadPage } from './operations-read-page'
import type { OperationsPageState } from './types'
import { SessionUserSelect } from '../../shared/ui/session-user-select'
import { SensitiveExportButton } from '../admin-runtime/sensitive-export-button'
import { opportunityQueryFilters } from '../../modules/opportunity-query'

export function OpportunitiesContentPage(props: OperationsPageState) {
  const definition = getAdminReadRouteDefinition('opportunities')
  const navigate = useNavigate()
  const changeFilter = (key: string, value: string) => props.onFilterChange({ ...props.query, filters: { ...props.query.filters, [key]: value } })
  const timeType = props.query.filters?.timeType || 'published'
  const section = props.query.filters?.section || 'opportunities'
  return (
    <OperationsReadPage
      {...props}
      title="机会与内容"
      description="查看机会、用户内容、撮合和评论事实"
      searchPlaceholder={definition.searchPlaceholder}
      statusOptions={definition.statusOptions}
      paginated={definition.paginated}
      timeRangeFields={section === 'opportunities' ? { from: `${timeType}From`, to: `${timeType}To`, label: '时间范围' } : undefined}
      amountRangeFields={section === 'opportunities' ? { min: 'minAmountCents', max: 'maxAmountCents', label: '价值（万元）', scale: 1000000 } : undefined}
      extraFilterSlots={<>
        <Form.Item label="浏览内容"><Select aria-label="机会分区" value={section} options={[{ value: 'opportunities', label: '机会' }, { value: 'content', label: '合作卡与案例' }, { value: 'matching', label: '撮合设置与记录' }]} onChange={value => props.onFilterChange({ query: '', status: '', filters: { section: value } })} /></Form.Item>
        {section === 'opportunities' ? <Form.Item label="城市"><Input aria-label="合作城市" value={props.query.filters?.cityQuery || ''} onChange={event => changeFilter('cityQuery', event.target.value)} allowClear /></Form.Item> : null}
        {section !== 'matching' ?
        <Form.Item label="发布人"><div style={{ minWidth: 180 }}><SessionUserSelect action="mip.admin.opportunities.options" value={props.query.filters?.ownerUserId} onChange={value => { if (typeof value === 'string') changeFilter('ownerUserId', value) }} /></div></Form.Item>
        : null}
        {section === 'opportunities' ? <Form.Item label="时间类型"><Select value={timeType} options={[{ value: 'published', label: '发布时间' }, { value: 'updated', label: '更新时间' }, { value: 'deadline', label: '截止时间' }]} onChange={value => {
          const filters: Record<string, string> = { ...props.query.filters, timeType: value }
          for (const prefix of ['published', 'updated', 'deadline']) { delete filters[`${prefix}From`]; delete filters[`${prefix}To`] }
          props.onFilterChange({ ...props.query, filters })
        }} /></Form.Item> : null}
      </>}
      detailRouteForSection={section => section.title === '机会'
        ? 'opportunities'
        : section.title === '用户内容' ? 'userContent' : null}
      actions={props.onWrite ? (
        <Space wrap>
          {section === 'opportunities' ? <SensitiveExportButton kind="opportunities" query={props.query.query} status={props.query.status} filters={opportunityQueryFilters(props.query)} /> : null}
          <Button icon={<PlusOutlined />} onClick={() => void navigate({ to: '/userContent/$contentId/edit' as never, params: { contentId: 'new' } as never, search: previous => ({ kind: 'COOPERATION_CARD', returnSearch: { ...previous, filters: { ...previous.filters, section: 'content' } } }) as never })}>创建合作卡</Button>
          <Button icon={<PlusOutlined />} onClick={() => void navigate({ to: '/userContent/$contentId/edit' as never, params: { contentId: 'new' } as never, search: previous => ({ kind: 'SUPER_CASE', returnSearch: { ...previous, filters: { ...previous.filters, section: 'content' } } }) as never })}>创建超级案例</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => void navigate({ to: '/opportunities/$opportunityId/edit' as never, params: { opportunityId: 'new' } as never, search: previous => ({ returnSearch: previous }) as never })}>创建机会</Button>
        </Space>
      ) : null}
    />
  )
}
