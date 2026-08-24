export const reportCategoryOptions = [
  { value: 'SPAM', label: '垃圾信息' },
  { value: 'HARASSMENT', label: '骚扰行为' },
  { value: 'FRAUD', label: '欺诈风险' },
  { value: 'INAPPROPRIATE_CONTENT', label: '不当内容' },
  { value: 'IMPERSONATION', label: '冒充他人' },
  { value: 'OTHER', label: '其他问题' },
] as const

export type ReportCategory = (typeof reportCategoryOptions)[number]['value']

export interface CommunityRelationship {
  profileRef: string
  isSelf: boolean
  blocked: boolean
}

export interface BlockMutationResult {
  profileRef: string
  blocked: boolean
  changed: boolean
  version: number
}

export interface BlockedProfile {
  profileRef: string
  nickname: string
  avatarUrl?: string
  headline?: string
  cityName?: string
  blockedAt: string
}

export interface BlockedProfilePage {
  items: BlockedProfile[]
  nextCursor?: string
}

export interface ReportReceipt {
  reportId: string
  status: 'PENDING' | 'REVIEWING' | 'RESOLVED' | 'DISMISSED'
  idempotent: boolean
}

export interface CommunityReportIntent {
  profileRef: string
  category: ReportCategory
  description: string
  requestId: string
}
