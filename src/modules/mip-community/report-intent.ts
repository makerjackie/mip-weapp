import type { CommunityReportIntent, ReportCategory } from './types'

export function createCommunityRequestId() {
  return `community-report-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`
}

export function createCommunityReportIntent(
  profileRef: string,
  category: ReportCategory,
  description: string,
  requestId = createCommunityRequestId(),
): CommunityReportIntent {
  return {
    profileRef: profileRef.trim(),
    category,
    description: description.trim(),
    requestId,
  }
}
