import type { AdminOperationAction, AdminRequestInput } from '../domain/contracts'
import type { AdminDetailRoute } from './admin-details.ts'
import type { AdminOperationRow } from './admin-row-operations.ts'

export type AdminListRoute = 'users' | 'events' | 'orders' | 'tasks' | 'banners' | 'game' | 'permissions' | 'messages' | 'knowledge' | 'opportunities' | 'growth' | 'operations' | 'adminAccounts' | 'auditLogs'
export type AdminTableRow = AdminOperationRow

export interface AdminTableColumn {
  key: string
  label: string
}

export interface AdminTableSection {
  key?: string
  title?: string
  rows: AdminTableRow[]
  columns: AdminTableColumn[]
  detailTarget?: AdminDetailRoute | null
}

export interface AdminReadPage {
  sections: AdminTableSection[]
  nextCursor: string | null
  summary?: Array<{ label: string; value: string }>
}

export interface AdminListQuery {
  query: string
  status: string
  cursor: string | null
  limit: number
  filters?: Record<string, string>
}

export interface FilterDimensionSpec {
  key: string
  urlParam: string
  multi?: boolean
}

export interface AdminReadRouteDefinition {
  searchPlaceholder: string
  statusOptions: Array<{ value: string; label: string }>
  paginated: boolean
  filterDimensions?: readonly FilterDimensionSpec[]
}

export interface AdminReadAccess {
  hasCapability: (capability: string, scopeType?: string) => boolean
}

export type AdminRequest = <T>(action: AdminOperationAction, input?: AdminRequestInput) => Promise<T>
