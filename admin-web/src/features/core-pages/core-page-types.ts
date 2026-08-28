import type { AdminDetailRoute } from '../../modules/admin-details'
import type { AdminEventMutationAction } from '../../modules/admin-event-mutation-forms'
import type { AdminTableRow } from '../../modules/admin-read-pages'
import type { SensitiveExportKind } from '../../modules/admin-sensitive-export'

export interface CorePageSearchState {
  q?: string
  status?: string
  cursor?: string
  page?: number
}

export interface CorePageDetailIntent {
  route: Extract<AdminDetailRoute, 'users' | 'events' | 'orders'>
  id: string
  row: AdminTableRow
}

export interface CorePageMutationIntent {
  action: AdminEventMutationAction
  targetId: string
}

export interface CorePageExportIntent {
  kind: SensitiveExportKind
  filters: {
    query: string
    status: string
  }
}

export interface CoreListPageCallbacks {
  onSearchChange: (search: CorePageSearchState) => void
  onOpenDetail: (intent: CorePageDetailIntent) => void
  onPreviousPage?: () => void
  onMutation?: (intent: CorePageMutationIntent) => void
  onSensitiveExport?: (intent: CorePageExportIntent) => void
}

export type CoreNavigationTarget = '/users' | '/events' | '/orders' | '/tasks' | '/operations'
