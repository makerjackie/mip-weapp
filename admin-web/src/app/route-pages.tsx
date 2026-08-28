import { App } from 'antd'
import { useNavigate, useRouter, useRouterState } from '@tanstack/react-router'
import { useCallback, useEffect, useState } from 'react'
import { useAdminSession } from './session-provider'
import type { AdminListSearch } from './router'
import {
  EventsPage,
  OrdersPage,
  OverviewPage,
  UsersPage,
  type CorePageSearchState,
} from '../features/core-pages'
import {
  BannerManagementPage,
  GameManagementPage,
  GrowthBadgesPage,
  MediaUploadPage,
  OpportunitiesContentPage,
  TaskManagementPage,
  type OperationsPageState,
  type OperationsWriteIntent,
} from '../features/operations-pages'
import {
  KnowledgePage,
  MessagesPage,
  OperationsPage,
  PermissionsPage,
  type GovernanceMutationRequest,
  type GovernanceRoute,
} from '../features/governance-pages'
import { AdminDetailActions, useDetailRowAction } from '../features/admin-runtime/admin-detail-actions'
import { useAdminDetail } from '../features/admin-runtime/use-admin-detail'
import { useAdminOperations } from '../features/admin-runtime/admin-operation-provider'
import { SensitiveExportButton } from '../features/admin-runtime/sensitive-export-button'
import { useAdminReadPage } from '../features/admin-runtime/use-admin-read-page'
import type { AdminDetailRoute } from '../modules/admin-details'
import {
  ADMIN_MEDIA_PURPOSE_OPTIONS,
  ADMIN_MEDIA_PURPOSE_CAPABILITIES,
  availableAdminMediaPurposeOptions,
  type AdminMediaFile,
  type AdminMediaPurpose,
  type AdminMediaUploadResult,
} from '../modules/admin-media-upload'
import { getAdminReadRouteDefinition, type AdminListQuery } from '../modules/admin-read-pages'
import { downloadTaskCompletionExport, exportTaskCompletions } from '../modules/admin-task-management'
import { DetailDrawer, PermissionGuard } from '../shared/ui'

type CoreRoute = 'users' | 'events' | 'orders'
type OperationsRoute = 'tasks' | 'banners' | 'game' | 'opportunities' | 'growth'

export function OverviewRoutePage() {
  const navigate = useNavigate()
  return <OverviewPage onNavigate={target => void navigate({ to: target })} />
}

export function UsersRoutePage() { return <CoreRoutePage route="users" /> }
export function EventsRoutePage() { return <CoreRoutePage route="events" /> }
export function OrdersRoutePage() { return <CoreRoutePage route="orders" /> }

function CoreRoutePage({ route }: { route: CoreRoute }) {
  const { launch } = useAdminOperations()
  const search = useRouteSearch()
  const updateSearch = useUpdateSearch()
  const router = useRouter()
  const detail = useAdminDetail()
  const [exportIntent, setExportIntent] = useState<{ kind: 'users' | 'orders'; query: string; status: string } | null>(null)
  const common = {
    search: search as CorePageSearchState,
    onSearchChange: (next: CorePageSearchState) => void updateSearch(next),
    onPreviousPage: search.page && search.page > 1 ? () => router.history.back() : undefined,
    onOpenDetail: (intent: { route: AdminDetailRoute; id: string }) => detail.openDetail(intent.route, intent.id),
    onMutation: (intent: { action: string; targetId: string }) => void launch(intent.action, intent.targetId),
    onSensitiveExport: (intent: { kind: 'users' | 'orders'; filters: { query: string; status: string } }) => setExportIntent({
      kind: intent.kind, query: intent.filters.query, status: intent.filters.status,
    }),
  }
  const page = route === 'users' ? <UsersPage {...common} />
    : route === 'events' ? <EventsPage {...common} /> : <OrdersPage {...common} />
  return (
    <>
      {page}
      <RouteDetailLayer detail={detail} />
      {exportIntent ? (
        <SensitiveExportButton
          hideTrigger
          open
          kind={exportIntent.kind}
          query={exportIntent.query}
          status={exportIntent.status}
          onOpenChange={open => { if (!open) setExportIntent(null) }}
        />
      ) : null}
    </>
  )
}

export function TasksRoutePage() { return <OperationsRoutePage route="tasks" /> }
export function BannersRoutePage() { return <OperationsRoutePage route="banners" /> }
export function GameRoutePage() { return <OperationsRoutePage route="game" /> }
export function OpportunitiesRoutePage() { return <OperationsRoutePage route="opportunities" /> }
export function GrowthRoutePage() { return <OperationsRoutePage route="growth" /> }

function OperationsRoutePage({ route }: { route: OperationsRoute }) {
  const { demoMode, hasCapability } = useAdminSession()
  const { launch } = useAdminOperations()
  const navigate = useNavigate()
  const search = useRouteSearch()
  const updateSearch = useUpdateSearch()
  const router = useRouter()
  const detail = useAdminDetail()
  const query = listQuery(search)
  const result = useAdminReadPage(route, query)
  const canWrite = demoMode || operationRouteCapabilities[route].some(hasCapability)
  const onWrite = canWrite ? (intent: OperationsWriteIntent) => void launch(intent.action, intent.targetId, detail.view, {
    values: intent.values,
    expectedVersion: intent.expectedVersion,
    allowedCapabilities: intent.allowedCapabilities,
  }) : undefined
  const state: OperationsPageState = {
    page: result.data || null,
    query,
    loading: result.loading,
    error: result.errorMessage,
    demoMode,
    hasPreviousPage: Boolean(search.page && search.page > 1),
    onFilterChange: value => void updateSearch({ q: value.query || undefined, status: value.status || undefined }),
    onRefresh: () => void result.refetch(),
    onPreviousPage: () => router.history.back(),
    onNextPage: cursor => void updateSearch({ ...search, cursor, page: (search.page || 1) + 1 }),
    onOpenDetail: intent => detail.openDetail(intent.route, intent.id),
    onWrite,
  }
  const page = route === 'tasks' ? <TaskManagementPage {...state} />
    : route === 'banners' ? <BannerManagementPage {...state} onOpenMedia={purpose => void navigate({ to: '/media', search: { tab: purpose } })} />
      : route === 'game' ? <GameManagementPage {...state} />
        : route === 'opportunities' ? <OpportunitiesContentPage {...state} />
          : <GrowthBadgesPage {...state} />
  return (
    <PermissionGuard capabilities={operationRouteCapabilities[route]} requireAny={operationRouteCapabilities[route].length > 1}>
      {page}
      <RouteDetailLayer detail={detail} onMediaUpload={() => void navigate({ to: '/media', search: { tab: 'BANNER' } })} />
    </PermissionGuard>
  )
}

export function MediaRoutePage() {
  const { message } = App.useApp()
  const { client, demoMode, session } = useAdminSession()
  const search = useRouteSearch()
  const updateSearch = useUpdateSearch()
  const options = demoMode ? ADMIN_MEDIA_PURPOSE_OPTIONS : availableAdminMediaPurposeOptions(session?.capabilities)
  const selected = options.some(option => option.value === search.tab) ? search.tab as AdminMediaPurpose : options[0]?.value || ''
  const [file, setFile] = useState<AdminMediaFile | null>(null)
  const [previewUrl, setPreviewUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<AdminMediaUploadResult | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => () => { if (previewUrl.startsWith('blob:')) URL.revokeObjectURL(previewUrl) }, [previewUrl])
  const changeFile = (next: AdminMediaFile | null) => {
    if (previewUrl.startsWith('blob:')) URL.revokeObjectURL(previewUrl)
    setFile(next)
    setPreviewUrl(next instanceof Blob ? URL.createObjectURL(next) : '')
    setResult(null)
    setCopied(false)
  }
  const upload = async (nextFile: AdminMediaFile, purpose: AdminMediaPurpose) => {
    setBusy(true)
    setError('')
    try { setResult(await client.uploadImage(nextFile, purpose)) }
    catch (reason) { setError(reason instanceof Error ? reason.message : '图片上传失败') }
    finally { setBusy(false) }
  }
  return (
    <PermissionGuard capabilities={options.map(option => ADMIN_MEDIA_PURPOSE_CAPABILITIES[option.value])} requireAny>
      <MediaUploadPage
        purposeOptions={options}
        selectedPurpose={selected}
        file={file}
        previewUrl={previewUrl}
        busy={busy}
        error={error}
        result={result}
        copied={copied}
        demoMode={demoMode}
        onPurposeChange={purpose => void updateSearch({ ...search, tab: purpose })}
        onFileChange={changeFile}
        onValidationError={setError}
        onUpload={(nextFile, purpose) => void upload(nextFile, purpose)}
        onCopyAssetId={async (assetId) => {
          try { await navigator.clipboard.writeText(assetId); setCopied(true); void message.success('素材 ID 已复制') }
          catch { void message.error('当前浏览器无法复制素材 ID') }
        }}
      />
    </PermissionGuard>
  )
}

export function PermissionsRoutePage() { return <GovernanceRoutePage route="permissions" /> }
export function MessagesRoutePage() { return <GovernanceRoutePage route="messages" /> }
export function KnowledgeRoutePage() { return <GovernanceRoutePage route="knowledge" /> }
export function OperationsLogRoutePage() { return <GovernanceRoutePage route="operations" /> }

function GovernanceRoutePage({ route }: { route: GovernanceRoute }) {
  const session = useAdminSession()
  const { launch } = useAdminOperations()
  const search = useRouteSearch()
  const updateSearch = useUpdateSearch()
  const detail = useAdminDetail()
  const query = listQuery(search)
  const result = useAdminReadPage(route, query)
  const common = {
    page: result.data || null,
    routeDefinition: getAdminReadRouteDefinition(route),
    filter: { q: query.query, status: query.status },
    activeTab: search.tab || '',
    loading: result.loading,
    error: result.errorMessage,
    demoMode: session.demoMode,
    canCapability: session.hasCapability,
    onFilterChange: (value: { q: string; status: string }) => void updateSearch({ q: value.q || undefined, status: value.status || undefined, tab: search.tab }),
    onTabChange: (tab: string) => void updateSearch({ ...search, tab }),
    onRefresh: () => void result.refetch(),
    onViewDetail: (intent: { route: 'messages' | 'knowledge'; id: string }) => detail.openDetail(intent.route, intent.id),
    onMutationRequest: (intent: GovernanceMutationRequest) => void launch(intent.action, intent.targetId, detail.view, {
      values: intent.values,
      expectedVersion: intent.expectedVersion,
      allowedCapabilities: intent.allowedCapabilities,
    }),
  }
  const page = route === 'permissions' ? <PermissionsPage {...common} />
    : route === 'messages' ? <MessagesPage {...common} />
      : route === 'knowledge' ? <KnowledgePage {...common} /> : <OperationsPage {...common} />
  const capabilities = governanceRouteCapabilities[route]
  return (
    <PermissionGuard capabilities={capabilities} requireAny={capabilities.length > 1}>
      {page}
      <RouteDetailLayer detail={detail} />
    </PermissionGuard>
  )
}

function RouteDetailLayer({ detail, onMediaUpload }: {
  detail: ReturnType<typeof useAdminDetail>
  onMediaUpload?: () => void
}) {
  const { message } = App.useApp()
  const { demoMode, request } = useAdminSession()
  const handleRowAction = useDetailRowAction(detail.view)
  const selection = detail.selection
  const actions = selection && detail.view ? (
    <AdminDetailActions
      route={selection.route}
      id={selection.id}
      view={detail.view}
      onMediaUpload={onMediaUpload}
      onTaskExport={async (taskId) => {
        if (demoMode) { void message.info('演示模式不会导出任务完成记录'); return }
        try {
          const value = await exportTaskCompletions(taskId, request)
          downloadTaskCompletionExport(value)
          void message.success(`已导出 ${value.rowCount} 条完成记录`)
        }
        catch (reason) { void message.error(reason instanceof Error ? reason.message : '导出失败') }
      }}
    />
  ) : undefined
  return (
    <DetailDrawer
      open={Boolean(selection)}
      view={detail.view}
      loading={detail.loading}
      error={detail.error}
      actions={actions}
      onClose={detail.closeDetail}
      onRowAction={operation => void handleRowAction(operation)}
      onNestedView={(target, row) => detail.openDetail(target, String(row.detailId || ''))}
    />
  )
}

function useRouteSearch() {
  return useRouterState({ select: state => state.location.search }) as AdminListSearch
}

function useUpdateSearch() {
  const navigate = useNavigate()
  return useCallback((next: AdminListSearch) => navigate({ search: next as never }), [navigate])
}

function listQuery(search: AdminListSearch): AdminListQuery {
  return { query: search.q?.trim() || '', status: search.status || '', cursor: search.cursor || null, limit: 20 }
}

const operationRouteCapabilities: Record<OperationsRoute, string[]> = {
  tasks: ['tasks.manage'],
  banners: ['banners.manage'],
  game: ['game.manage'],
  opportunities: ['opportunities.moderate', 'userContent.moderate'],
  growth: ['growth.adjust', 'badges.manage'],
}

const governanceRouteCapabilities: Record<GovernanceRoute, string[]> = {
  permissions: ['roles.change', 'branches.manage', 'audit.read'],
  messages: ['messages.manage'],
  knowledge: ['knowledge.manage'],
  operations: ['announcements.manage', 'community.reports.manage', 'operations.exceptions.read'],
}

export const routeComponents = {
  '/overview': OverviewRoutePage,
  '/users': UsersRoutePage,
  '/events': EventsRoutePage,
  '/orders': OrdersRoutePage,
  '/tasks': TasksRoutePage,
  '/banners': BannersRoutePage,
  '/media': MediaRoutePage,
  '/game': GameRoutePage,
  '/opportunities': OpportunitiesRoutePage,
  '/growth': GrowthRoutePage,
  '/permissions': PermissionsRoutePage,
  '/messages': MessagesRoutePage,
  '/knowledge': KnowledgeRoutePage,
  '/operations': OperationsLogRoutePage,
} as const
