import type {
  AdminCapabilityGrant,
  AdminEventCatalogItem,
} from '../../../modules/mip-admin'
import { formatLocalDateTime } from '../../../utils/date'

export type EventCatalogView = AdminEventCatalogItem & {
  kindText: string
  statusText: string
  statusTheme: 'default' | 'success' | 'warning'
  updatedText: string
}

export interface EventCatalogDraft {
  key: string
  name: string
  description: string
  sortOrder: string
}

const stableKeyPattern = /^[\w.:-]+$/

export function hasPlatformCatalogCapability(grants: AdminCapabilityGrant[]) {
  return grants.some(grant => (
    grant.capability === 'events.catalog.manage'
    && grant.scopeType === 'PLATFORM'
    && grant.scopeId === null
  ))
}

export function eventCatalogDraftError(draft: EventCatalogDraft, updating: boolean) {
  const key = draft.key.trim()
  const name = draft.name.trim()
  const description = draft.description.trim()
  const sortOrder = Number(draft.sortOrder)
  if (!updating && (!key || key.length > 64 || !stableKeyPattern.test(key))) {
    return '稳定标识需为 1–64 位字母、数字、下划线、点、冒号或连字符'
  }
  if (!name || name.length > 80) {
    return '名称需为 1–80 个字符'
  }
  if (description.length > 300) {
    return '说明不能超过 300 个字符'
  }
  if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 1_000_000) {
    return '显示顺序需为 0–1000000 的整数'
  }
  return ''
}

export function eventCatalogView(item: AdminEventCatalogItem): EventCatalogView {
  return {
    ...item,
    kindText: item.kind === 'TYPE' ? '活动分类' : '活动标签',
    statusText: item.status === 'ACTIVE' ? '已启用' : item.status === 'INACTIVE' ? '已停用' : '已归档',
    statusTheme: item.status === 'ACTIVE' ? 'success' : item.status === 'INACTIVE' ? 'warning' : 'default',
    updatedText: formatLocalDateTime(item.updatedAt),
  }
}
