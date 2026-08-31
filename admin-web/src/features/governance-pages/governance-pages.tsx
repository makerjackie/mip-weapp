import { PlusOutlined } from '@ant-design/icons'
import { Button, Space, Tabs, Tag } from 'antd'
import type { ReactNode } from 'react'
import {
  ADMIN_PEOPLE_MUTATION_ACTIONS,
  ADMIN_PEOPLE_MUTATION_CONFIG,
  type AdminPeopleMutationAction,
} from '../../modules/admin-people-mutation-forms'
import type { AdminDetailRoute } from '../../modules/admin-details'
import {
  CONTENT_MUTATION_ACTIONS,
  getContentMutationForm,
  type ContentMutationAction,
} from '../../modules/content-mutation-forms'
import type {
  AdminReadPage,
  AdminReadRouteDefinition,
  AdminTableRow,
} from '../../modules/admin-read-pages'
import type {
  AdminRowOperation,
  AdminRowOperationAction,
} from '../../modules/admin-row-operations'
import {
  DataTable,
  EmptyState,
  ErrorState,
  FilterBar,
  LoadingState,
  PageHeader,
} from '../../shared/ui'

export type GovernanceRoute = 'permissions' | 'messages' | 'knowledge' | 'operations'

export interface GovernanceFilterValue {
  q: string
  status: string
}

export interface GovernanceMutationRequest {
  action: AdminPeopleMutationAction | ContentMutationAction | AdminRowOperationAction
  capability: string
  targetId?: string
  values?: Record<string, unknown>
  expectedVersion?: number
  allowedCapabilities?: string[]
}

export interface GovernanceDetailRequest {
  route: Extract<AdminDetailRoute, 'messages' | 'knowledge'>
  id: string
}

export interface GovernancePageProps {
  page: AdminReadPage | null
  routeDefinition: AdminReadRouteDefinition
  filter: GovernanceFilterValue
  activeTab: string
  loading?: boolean
  error?: string
  demoMode?: boolean
  canCapability: (capability: string) => boolean
  onFilterChange: (value: GovernanceFilterValue) => void
  onTabChange: (tab: string) => void
  onRefresh?: () => void
  onViewDetail?: (request: GovernanceDetailRequest) => void
  onMutationRequest?: (request: GovernanceMutationRequest) => void
}

interface SectionSpec {
  key: string
  label: string
  detailTarget?: GovernanceDetailRequest['route']
}

interface PageActionSpec {
  label: string
  action: AdminPeopleMutationAction | ContentMutationAction
  capability: string
}

interface GovernancePageSpec {
  title: string
  description: string
  sections: readonly SectionSpec[]
  actions: readonly PageActionSpec[]
}

const createBranch = peopleAction('mip.admin.branches.create', '新建服务器')
const createMessage = contentAction('mip.admin.messageCampaigns.save', '创建消息')
const createMessageTemplate = contentAction('mip.admin.messageTemplates.save', '新建消息模板')
const createKnowledgeContent = contentAction('mip.admin.knowledge.contents.save', '新建内容')
const createKnowledgeSchedule = contentAction('mip.admin.knowledge.schedules.save', '新建采集计划')
const createAnnouncement = contentAction('mip.admin.announcements.save', '新建公告')

const pageSpecs: Record<GovernanceRoute, GovernancePageSpec> = {
  permissions: {
    title: '权限管理',
    description: '查看运营成员、角色策略、服务器和审计记录。',
    sections: [
      { key: 'members', label: '运营成员' },
      { key: 'policies', label: '角色策略' },
      { key: 'branches', label: '服务器' },
      { key: 'audit', label: '审计记录' },
    ],
    actions: [createBranch],
  },
  messages: {
    title: '消息管理',
    description: '查看消息活动及服务端记录的投递状态。',
    sections: [
      { key: 'campaigns', label: '消息活动', detailTarget: 'messages' },
      { key: 'templates', label: '消息模板' },
    ],
    actions: [createMessage, createMessageTemplate],
  },
  knowledge: {
    title: '知识库',
    description: '查看知识内容、审核状态和同步计划。',
    sections: [{ key: 'contents', label: '知识内容', detailTarget: 'knowledge' }],
    actions: [createKnowledgeContent, createKnowledgeSchedule],
  },
  operations: {
    title: '运营记录',
    description: '查看公告、社区举报、运营异常和待办记录。',
    sections: [
      { key: 'announcements', label: '公告' },
      { key: 'reports', label: '社区举报' },
      { key: 'exceptions', label: '运营异常' },
      { key: 'queue', label: '运营待办' },
    ],
    actions: [createAnnouncement],
  },
}

export function PermissionsPage(props: GovernancePageProps) {
  return <GovernancePage route="permissions" {...props} />
}

export function MessagesPage(props: GovernancePageProps) {
  return <GovernancePage route="messages" {...props} />
}

export function KnowledgePage(props: GovernancePageProps) {
  return <GovernancePage route="knowledge" {...props} />
}

export function OperationsPage(props: GovernancePageProps) {
  return <GovernancePage route="operations" {...props} />
}

export function GovernancePage({
  route,
  page,
  routeDefinition,
  filter,
  activeTab,
  loading = false,
  error,
  demoMode = false,
  canCapability,
  onFilterChange,
  onTabChange,
  onRefresh,
  onViewDetail,
  onMutationRequest,
}: GovernancePageProps & { route: GovernanceRoute }) {
  const spec = pageSpecs[route]
  const actions = onMutationRequest
    ? spec.actions.filter(action => canCapability(action.capability))
    : []
  const headerActions = demoMode || actions.length ? (
    <Space wrap>
      {demoMode ? <Tag color="gold">演示数据</Tag> : null}
      {actions.map(action => (
        <Button
          key={action.action}
          type={action === actions[0] ? 'primary' : 'default'}
          icon={<PlusOutlined />}
          disabled={demoMode}
          aria-label={action.label}
          onClick={() => onMutationRequest?.({ action: action.action, capability: action.capability })}
        >
          {action.label}
        </Button>
      ))}
    </Space>
  ) : undefined
  const tabItems = createTabItems({
    route,
    page,
    spec,
    demoMode,
    canCapability,
    onViewDetail,
    onMutationRequest,
  })
  const selectedTab = tabItems.some(item => item.key === activeTab)
    ? activeTab
    : tabItems[0]?.key

  return (
    <>
      <PageHeader
        eyebrow="平台设置"
        title={spec.title}
        description={spec.description}
        actions={headerActions}
      />
      <FilterBar
        value={filter}
        placeholder={routeDefinition.searchPlaceholder}
        statusOptions={routeDefinition.statusOptions}
        loading={loading}
        onChange={onFilterChange}
        onRefresh={onRefresh}
      />
      {error ? <ErrorState description={error} onRetry={onRefresh} /> : null}
      {loading && !page ? <LoadingState label={`正在加载${spec.title}`} /> : null}
      {!loading && !error && !page ? (
        <EmptyState title="暂无页面数据" description="当前请求没有返回可显示的数据。" />
      ) : null}
      {page ? (
        <section aria-label={`${spec.title}分类`}>
          <Tabs
            activeKey={selectedTab}
            items={tabItems}
            onChange={onTabChange}
          />
        </section>
      ) : null}
    </>
  )
}

function createTabItems({
  route,
  page,
  spec,
  demoMode,
  canCapability,
  onViewDetail,
  onMutationRequest,
}: {
  route: GovernanceRoute
  page: AdminReadPage | null
  spec: GovernancePageSpec
  demoMode: boolean
  canCapability: GovernancePageProps['canCapability']
  onViewDetail?: GovernancePageProps['onViewDetail']
  onMutationRequest?: GovernancePageProps['onMutationRequest']
}): Array<{ key: string; label: string; children: ReactNode }> {
  if (!page) return []
  return page.sections.map((section, index) => {
    const sectionSpec = spec.sections.find(item => item.key === section.key) ?? spec.sections[index] ?? {
      key: `section-${index + 1}`,
      label: section.title || `分类 ${index + 1}`,
    }
    const renderActions = onMutationRequest
      ? (row: AdminTableRow) => renderRowActions(row, demoMode, canCapability, onMutationRequest)
      : undefined
    const onView = sectionSpec.detailTarget && onViewDetail
      ? (row: AdminTableRow) => {
          const id = identifier(row.detailId)
          if (id) onViewDetail({ route: sectionSpec.detailTarget as GovernanceDetailRequest['route'], id })
        }
      : undefined
    return {
      key: sectionSpec.key,
      label: section.title || sectionSpec.label,
      children: (
        <DataTable
          label={`${pageSpecs[route].title} - ${section.title || sectionSpec.label}`}
          rows={section.rows}
          columns={section.columns}
          onView={onView}
          renderActions={renderActions}
        />
      ),
    }
  })
}

function renderRowActions(
  row: AdminTableRow,
  demoMode: boolean,
  canCapability: GovernancePageProps['canCapability'],
  onMutationRequest: NonNullable<GovernancePageProps['onMutationRequest']>,
) {
  const operations = Array.isArray(row.rowActions)
    ? row.rowActions.filter(isAdminRowOperation)
    : []
  const available = operations.flatMap((operation) => {
    const capability = operationCapability(operation.action)
    return capability && canCapability(capability) ? [{ operation, capability }] : []
  })
  if (!available.length) return null
  return available.map(({ operation, capability }) => (
    <Button
      key={`${operation.action}-${operation.label}`}
      type="link"
      size="small"
      disabled={demoMode}
      aria-label={operation.label}
      onClick={() => onMutationRequest({
        action: operation.action,
        capability,
        ...(operation.targetId ? { targetId: operation.targetId } : {}),
        ...(operation.values ? { values: { ...operation.values } } : {}),
        ...(operation.expectedVersion !== undefined ? { expectedVersion: operation.expectedVersion } : {}),
        ...(operation.allowedCapabilities ? { allowedCapabilities: [...operation.allowedCapabilities] } : {}),
      })}
    >
      {operation.label}
    </Button>
  ))
}

function peopleAction(action: AdminPeopleMutationAction, label: string): PageActionSpec {
  return { action, label, capability: ADMIN_PEOPLE_MUTATION_CONFIG[action].capability }
}

function contentAction(action: ContentMutationAction, label: string): PageActionSpec {
  return { action, label, capability: getContentMutationForm(action).capability }
}

function operationCapability(action: AdminRowOperationAction) {
  if (isPeopleMutationAction(action)) return ADMIN_PEOPLE_MUTATION_CONFIG[action].capability
  if (isContentMutationAction(action)) return getContentMutationForm(action).capability
  return ''
}

function isPeopleMutationAction(action: string): action is AdminPeopleMutationAction {
  return (ADMIN_PEOPLE_MUTATION_ACTIONS as readonly string[]).includes(action)
}

function isContentMutationAction(action: string): action is ContentMutationAction {
  return (CONTENT_MUTATION_ACTIONS as readonly string[]).includes(action)
}

function isAdminRowOperation(value: unknown): value is AdminRowOperation {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const operation = value as Partial<AdminRowOperation>
  return typeof operation.action === 'string' && typeof operation.label === 'string'
}

function identifier(value: unknown) {
  const id = typeof value === 'string' ? value.trim() : ''
  return id && id.length <= 128 && /^[A-Za-z0-9_.:-]+$/.test(id) ? id : ''
}
