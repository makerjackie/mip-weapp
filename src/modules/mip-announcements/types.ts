export type AnnouncementScopeType = 'PLATFORM' | 'BRANCH'
export type AnnouncementTargetType = 'EVENT' | 'OPPORTUNITY'

export interface AnnouncementSummary {
  id: string
  title: string
  summary: string
  isPinned: boolean
  publishedAt: string
  visibleUntil?: string
  scopeType: AnnouncementScopeType
  branchName?: string
  targetType?: AnnouncementTargetType
  targetId?: string
}

export interface AnnouncementDetail extends AnnouncementSummary {
  body: string
}

export interface AnnouncementPage {
  items: AnnouncementSummary[]
  nextCursor?: string
}

export interface AnnouncementListQuery {
  branchId?: string
  cursor?: string
  limit?: number
}
