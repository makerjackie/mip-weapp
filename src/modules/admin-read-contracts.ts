import type { AdminRequestInput } from '../domain/contracts'

export type AdminListRoute = 'users' | 'events' | 'orders' | 'permissions' | 'messages' | 'knowledge' | 'opportunities' | 'growth' | 'operations'
export type AdminTableRow = Record<string, unknown>

export interface AdminTableColumn {
  key: string
  label: string
}

export interface AdminTableSection {
  title?: string
  rows: AdminTableRow[]
  columns: AdminTableColumn[]
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
}

export interface AdminReadRouteDefinition {
  searchPlaceholder: string
  statusOptions: Array<{ value: string; label: string }>
  paginated: boolean
}

export type AdminRequest = <T>(action: string, input?: AdminRequestInput) => Promise<T>
