import type { SuperCaseId } from '../mip'
import type { AiDraftSourceConfirmation } from '../mip-ai/types'

export type SuperCaseStatus = 'DRAFT' | 'PUBLISHED' | 'UNPUBLISHED' | 'ARCHIVED'

// 超级案例项目（figma 2173_42605）：一个案例可包含多个项目，「添加项目」整组追加。
// 展开讲讲为设计稿唯一选填项；其余字段在发布时必填。
export interface SuperCaseProject {
  projectName: string
  summary: string
  startedOn?: string
  responsibility: string
  cityTagId?: string
  region?: string
  caseType?: string
  description: string
}

export interface SuperCaseProjectView {
  projectName: string
  summary: string
  startedOn?: string
  responsibility: string
  cityLabel?: string
  region?: string
  caseType?: string
  description: string
}

export interface SuperCaseSummary {
  id: SuperCaseId
  projectName: string
  summary: string
  responsibility: string
  cityLabel?: string
  industryLabel?: string
  caseType?: string
  coverUrl?: string
  status: SuperCaseStatus
  publishedAt: string
  author: { profileRef: string, nickname: string, avatarUrl?: string, headline?: string }
  mine: boolean
  version?: number
}

export interface SuperCaseDetail extends SuperCaseSummary {
  startedOn?: string
  endedOn?: string
  description: string
  projects: SuperCaseProjectView[]
  media: Array<{ url: string, caption?: string }>
  coverAssetId?: string
  mediaAssetIds?: string[]
  version: number
  interestActive: boolean
  canEdit: boolean
}

export interface SuperCaseDraft {
  id?: SuperCaseId
  expectedVersion?: number
  // 兼容字段：镜像 projects[0]，由服务端同步维护；新提交必须携带 projects。
  projectName: string
  summary: string
  startedOn?: string
  endedOn?: string
  responsibility: string
  cityTagId?: string
  industryTagId?: string
  region?: string
  caseType?: string
  description: string
  projects: SuperCaseProject[]
  coverAssetId?: string
  mediaAssetIds: string[]
  publish: boolean
  aiConfirmation?: AiDraftSourceConfirmation
}

export interface SuperCasePage {
  items: SuperCaseSummary[]
  nextCursor?: string
}
