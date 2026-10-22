import { Button, Collapse, Descriptions, Dropdown, Modal, Space, Typography, type MenuProps } from 'antd'
import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import type { ConfigurationItem } from '../../modules/membership-configuration'
import { DownOutlined } from '@ant-design/icons'
import { getAdminReadRouteDefinition } from '../../modules/admin-read-pages'
import { options } from '../../modules/admin-read-formatters'
import { growthSections } from '../../modules/growth-sections'
import { OperationsReadPage } from './operations-read-page'
import { MembershipConfigurationPanel } from './membership-configuration-panel'
import { GrowthSectionSelect } from './growth-page-shared'
import type { OperationsPageState, OperationsWriteAction } from './types'

// MIW-129：等级管理页可见的 growth 分区。原「成长与勋章」页的等级/等级变更/勋章分区
// 收敛到本页；数据装配仍走 growth-sections 与 loadGrowth，只做页面拆分。
const LEVEL_SECTIONS = [
  { value: 'levels', label: '等级' },
  { value: 'transitions', label: '等级变更' },
  { value: 'badges', label: '勋章目录' },
  { value: 'awards', label: '勋章获得记录' },
] as const

const SECTION_STATUS_OPTIONS: Record<string, Array<{ value: string; label: string }>> = {
  levels: [{ value: '', label: '全部状态' }, ...options(['DRAFT', 'ACTIVE', 'INACTIVE'])],
  transitions: [{ value: '', label: '全部状态' }],
  badges: [{ value: '', label: '全部状态' }, ...options(['ACTIVE', 'INACTIVE'])],
  awards: [{ value: '', label: '全部状态' }, ...options(['ACTIVE', 'REVOKED'])],
}

// 撤销勋章不设全局入口：它需要某条获授记录的 ID 与版本，只有
// 「用户详情 → 勋章」的行上下文能提供（与拆分前的 growth 页口径一致）。
const badgeActions: Array<{ key: OperationsWriteAction; label: string; capability: string }> = [
  { key: 'mip.admin.badges.grant', label: '授予勋章', capability: 'badges.manage' },
]

export function GrowthLevelsPage(props: OperationsPageState) {
  const navigate = useNavigate()
  const [editingLevel, setEditingLevel] = useState<ConfigurationItem | null>(null)
  const [benefitLevel, setBenefitLevel] = useState<ConfigurationItem | null>(null)
  const definition = getAdminReadRouteDefinition('growth')
  // 与拆分前 growth 页一致：无读取能力的分区（如缺 badges.manage 的勋章分区）不出现在下拉中。
  const sections = LEVEL_SECTIONS.filter(section => {
    if (!props.canCapability) return true
    const defined = growthSections.find(item => item.value === section.value)
    return !defined?.capability || props.canCapability(defined.capability)
  })
  const selected = sections.some(section => section.value === props.query.filters?.section)
    ? props.query.filters!.section!
    : sections[0]?.value || 'levels'
  const canReadGrowth = !props.canCapability || props.canCapability('growth.read')
  const available = badgeActions.filter(action => !props.canCapability || props.canCapability(action.capability))
  const menu: MenuProps = {
    items: available,
    onClick: ({ key }) => props.onWrite?.({ action: key as OperationsWriteAction }),
  }
  return (
    <>
      {canReadGrowth ? (
        <Collapse
          ghost
          items={[
            { key: 'level-config', label: '等级门槛与权益配置', children: <MembershipConfigurationPanel onSaved={props.onRefresh} tabs={['levels', 'benefits']} title="等级内容配置" /> },
            { key: 'badge-config', label: '勋章配置', children: <MembershipConfigurationPanel onSaved={props.onRefresh} tabs={['badges']} title="勋章定义" /> },
          ]}
        />
      ) : null}
      <OperationsReadPage
        {...props}
        title="等级管理"
        description="查看等级门槛、等级权益、等级变更和勋章事实"
        searchPlaceholder={definition.searchPlaceholder}
        statusOptions={SECTION_STATUS_OPTIONS[selected] || [{ value: '', label: '全部状态' }]}
        paginated={selected === 'transitions' || selected === 'awards'}
        timeRangeFields={selected === 'transitions' ? { from: 'createdFrom', to: 'createdTo' } : undefined}
        extraFilterSlots={<GrowthSectionSelect sections={sections} page="等级管理" state={props} />}
        rowExtraActions={row => selected === 'levels' && row.levelItem ? <Space size={0} wrap>
          {(!props.canCapability || props.canCapability('growth.configure')) && !props.demoMode ? <Button type="link" size="small" onClick={() => setEditingLevel(row.levelItem as ConfigurationItem)}>编辑</Button> : null}
          <Button type="link" size="small" onClick={() => setBenefitLevel(row.levelItem as ConfigurationItem)}>权益</Button>
          {!props.canCapability || props.canCapability('users.read') ? <Button type="link" size="small" onClick={() => void navigate({ to: '/users', search: { status: 'ACTIVE', filters: { levelId: String((row.levelItem as ConfigurationItem).id) } } })}>用户明细</Button> : null}
        </Space> : null}
        actions={available.length ? (
          <Space wrap>
            {props.onWrite ? (
              <Dropdown menu={menu} placement="bottomRight">
                <Button type="primary">运营操作 <DownOutlined /></Button>
              </Dropdown>
            ) : null}
          </Space>
        ) : null}
      />
      {editingLevel ? <MembershipConfigurationPanel key={`${editingLevel.id}:${editingLevel.version}`} onSaved={props.onRefresh} tabs={['levels', 'benefits']} initialEdit={{ kind: 'levels', item: editingLevel }} onEditorClosed={() => setEditingLevel(null)} /> : null}
      <Modal open={Boolean(benefitLevel)} title={`${benefitLevel?.name || ''} · 等级权益`} footer={null} onCancel={() => setBenefitLevel(null)}>
        {Array.isArray(benefitLevel?.benefits) && benefitLevel.benefits.length ? <Descriptions column={1} items={benefitLevel.benefits.map((benefit: Record<string, unknown>) => ({ key: String(benefit.id), label: String(benefit.name || '权益'), children: String(benefit.description || '暂无说明') }))} /> : <Typography.Paragraph type="secondary">当前等级尚未绑定权益。</Typography.Paragraph>}
      </Modal>
    </>
  )
}
