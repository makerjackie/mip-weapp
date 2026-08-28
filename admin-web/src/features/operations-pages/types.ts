import type { AdminDetailRoute } from '../../modules/admin-details'
import type {
  AdminListQuery,
  AdminReadPage,
  AdminTableRow,
} from '../../modules/admin-read-pages'
import type { AdminBannerMutationAction } from '../../modules/admin-banner-management'
import type { AdminGameMutationAction } from '../../modules/admin-game-management'
import type { AdminRowOperationAction } from '../../modules/admin-row-operations'
import type { AdminTaskMutationAction } from '../../modules/admin-task-management'
import type { ContentMutationAction } from '../../modules/content-mutation-forms'

export type OperationsWriteAction =
  | AdminTaskMutationAction
  | AdminBannerMutationAction
  | AdminGameMutationAction
  | ContentMutationAction
  | AdminRowOperationAction

export interface OperationsWriteIntent {
  action: OperationsWriteAction
  targetId?: string
  values?: Record<string, unknown>
  expectedVersion?: number
  allowedCapabilities?: string[]
  row?: AdminTableRow
}

export interface OperationsDetailIntent {
  route: AdminDetailRoute
  id: string
  row: AdminTableRow
}

export interface OperationsPageCallbacks {
  onFilterChange: (query: Pick<AdminListQuery, 'query' | 'status'>) => void
  onRefresh: () => void
  onPreviousPage?: () => void
  onNextPage?: (cursor: string) => void
  onOpenDetail?: (intent: OperationsDetailIntent) => void
  onWrite?: (intent: OperationsWriteIntent) => void
}

export interface OperationsPageState extends OperationsPageCallbacks {
  page: AdminReadPage | null
  query: Pick<AdminListQuery, 'query' | 'status'>
  loading?: boolean
  error?: string
  demoMode?: boolean
  hasPreviousPage?: boolean
}
