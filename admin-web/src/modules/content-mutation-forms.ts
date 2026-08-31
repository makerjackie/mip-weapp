import type { AdminRequestInput } from '../domain/contracts'

/** The P0 write surface. Keep this list in sync with the reviewed server manifest. */
export const CONTENT_MUTATION_ACTIONS = [
  'mip.admin.announcements.save',
  'mip.admin.announcements.publish',
  'mip.admin.announcements.withdraw',
  'mip.admin.announcements.pin',
  'mip.admin.messageCampaigns.save',
  'mip.admin.messageCampaigns.snapshot',
  'mip.admin.messageCampaigns.schedule',
  'mip.admin.messageCampaigns.cancelSchedule',
  'mip.admin.messageCampaigns.publish',
  'mip.admin.messageCampaigns.withdraw',
  'mip.admin.messageTemplates.save',
  'mip.admin.messageTemplates.activate',
  'mip.admin.messageTemplates.archive',
  'mip.admin.communityReports.claim',
  'mip.admin.communityReports.close',
  'mip.admin.opportunities.save',
  'mip.admin.opportunities.publish',
  'mip.admin.opportunities.end',
  'mip.admin.opportunities.unpublish',
  'mip.admin.opportunities.archive',
  'mip.admin.userContent.save',
  'mip.admin.userContent.unpublish',
  'mip.admin.userContent.archive',
  'mip.admin.knowledge.contents.save',
  'mip.admin.knowledge.contents.review',
  'mip.admin.knowledge.schedules.save',
  'mip.admin.badges.grant',
  'mip.admin.badges.revoke',
  'mip.admin.growth.adjust',
] as const

/** Naming aliases used by the other admin form modules. */
export const ADMIN_CONTENT_MUTATION_ACTIONS = CONTENT_MUTATION_ACTIONS

export type ContentMutationAction = typeof CONTENT_MUTATION_ACTIONS[number]
export type AdminContentMutationAction = ContentMutationAction
export type ContentMutationCapability =
  | 'announcements.manage'
  | 'messages.manage'
  | 'community.reports.manage'
  | 'opportunities.moderate'
  | 'opportunities.archive'
  | 'userContent.moderate'
  | 'knowledge.manage'
  | 'badges.manage'
  | 'growth.adjust'

export type ContentMutationFieldKind =
  | 'text'
  | 'textarea'
  | 'integer'
  | 'checkbox'
  | 'select'
  | 'id'
  | 'id-list'
  | 'profile-ref-list'
  | 'date'
  | 'datetime'
  | 'time'
  | 'url'
  | 'group'

export interface ContentMutationField {
  readonly key: string
  readonly label: string
  readonly kind: ContentMutationFieldKind
  readonly required?: boolean
  readonly options?: readonly string[]
  readonly maxLength?: number
  readonly fields?: readonly ContentMutationField[]
  readonly visibleWhen?: {
    readonly path: string
    readonly value: string
  }
}

export interface ContentMutationFormDefinition {
  readonly action: ContentMutationAction
  readonly capability: ContentMutationCapability
  readonly resource: string
  readonly inputKeys: readonly string[]
  readonly idempotencyRequired: boolean
  readonly fields: readonly ContentMutationField[]
}

export interface ValidationFailure {
  readonly ok: false
  readonly errors: Readonly<Record<string, string>>
}

export interface ValidationSuccess<T extends AdminRequestInput = AdminRequestInput> {
  readonly ok: true
  readonly input: T
}

export type ContentMutationValidation = ValidationFailure | ValidationSuccess

export interface ContentMutationIntent {
  readonly action: ContentMutationAction
  readonly idempotencyKey?: string
  readonly input: AdminRequestInput
}

type ScopeType = 'PLATFORM' | 'BRANCH'
type AnnouncementTarget = 'EVENT' | 'OPPORTUNITY'
type AudienceType = 'ALL' | 'EXPLICIT'
type ContentKind = 'COOPERATION_CARD' | 'SUPER_CASE'
type OpportunityRole =
  | 'connector'
  | 'business_builder'
  | 'capital_operator'
  | 'strategist'
  | 'visual_designer'
  | 'delivery_lead'

interface AnnouncementInput {
  announcementId?: string
  expectedVersion?: number
  scopeType: ScopeType
  branchId?: string
  title: string
  summary: string
  body: string
  targetType?: AnnouncementTarget
  targetId?: string
  visibleFrom: string
  visibleUntil?: string
}

interface MessageCampaignInput {
  campaignId?: string
  expectedVersion?: number
  scopeType: ScopeType
  branchId?: string
  audienceType: AudienceType
  recipientRefs: string[]
  name: string
  title: string
  body: string
}

interface MessageCampaignVersionInput {
  campaignId: string
  expectedVersion: number
}

interface MessageCampaignScheduleInput extends MessageCampaignVersionInput {
  expectedDispatchVersion?: number
  scheduledFor: string
  idempotencyKey?: string
}

interface MessageCampaignCancelScheduleInput extends MessageCampaignVersionInput {
  expectedDispatchVersion: number
  reason: string
  idempotencyKey: string
}

interface MessageCampaignPublishInput extends MessageCampaignVersionInput {
  idempotencyKey: string
}

interface MessageCampaignReasonInput extends MessageCampaignVersionInput {
  reason: string
}

interface MessageTemplateInput {
  templateId?: string
  expectedVersion?: number
  scopeType: ScopeType
  branchId?: string
  name: string
  title: string
  body: string
}

interface CommunityReportClaimInput {
  reportId: string
  expectedVersion: number
  reason: string
}

interface CommunityReportCloseInput extends CommunityReportClaimInput {
  outcome: 'RESOLVED' | 'DISMISSED'
}

interface CommercialLocation {
  type: 'CITY' | 'NATIONAL' | 'REMOTE'
  cityTagId?: string
}

interface CommercialTerms {
  currency?: 'CNY'
  amountUnit?: 'CNY_CENTS'
  minAmountCents?: number | null
  maxAmountCents?: number | null
  locations: CommercialLocation[]
}

interface OpportunityInput {
  opportunityId?: string
  expectedVersion?: number
  draft: {
    ownerUserId: string
    scopeType: ScopeType
    branchId?: string
    title: string
    valueSummary: string
    targetSummary?: string
    description?: string
    cityTagId?: string
    commercialTerms?: CommercialTerms | null
    roleKeys: OpportunityRole[]
    tagIds: string[]
    deadlineAt?: string
  }
}

interface ContentReasonInput {
  kind: ContentKind
  contentId: string
  expectedVersion: number
  reason: string
}

interface CooperationCardDraft {
  kind: 'COOPERATION_CARD'
  roleKey: OpportunityRole
  positioning: string
  targetSummary: string
  roleFields: Record<string, string | string[]>
  abilityScores: Record<string, number>
  status?: 'DRAFT' | 'PUBLISHED' | 'UNPUBLISHED'
}

interface SuperCaseDraft {
  kind: 'SUPER_CASE'
  projectName: string
  summary: string
  startedOn?: string
  endedOn?: string
  responsibility: string
  cityTagId?: string | null
  industryTagId?: string | null
  caseType?: string
  description: string
  coverAssetId?: string | null
  mediaAssetIds: string[]
  status?: 'DRAFT' | 'PUBLISHED' | 'UNPUBLISHED'
}

interface UserContentSaveInput {
  kind: ContentKind
  contentId?: string
  expectedVersion?: number
  ownerUserId: string
  draft: CooperationCardDraft | SuperCaseDraft
}

interface KnowledgeContentInput {
  contentId?: string
  expectedVersion?: number
  sourceId?: string
  categoryId: string
  contentType: 'HOT_NEWS' | 'ARTICLE' | 'WEB' | 'VIDEO' | 'PRIVATE_CHANNEL' | 'EXPERT_SHARE'
  title: string
  summary: string
  bodyText?: string
  externalUrl?: string
  channelFinderUserName?: string
  channelFeedId?: string
  coverAssetId?: string
  authorName?: string
  accessType: 'FREE' | 'MEMBER' | 'MEMBER_OR_PAID'
  commentsEnabled: boolean
  moderationMode: 'AUTO' | 'REVIEW'
}

interface KnowledgeReviewInput {
  contentId: string
  expectedVersion: number
  decision: 'SUBMIT' | 'APPROVE' | 'REJECT' | 'PUBLISH' | 'WITHDRAW'
  reason?: string
}

interface KnowledgeScheduleInput {
  scheduleId?: string
  expectedVersion?: number
  sourceId: string
  categoryId: string
  dailyTime: string
  timeZone: string
  status?: 'ACTIVE' | 'PAUSED'
  idempotencyKey?: string
}

interface BadgeAwardInput { userId: string; badgeId: string; reason: string }
interface BadgeRevokeInput { awardId: string; expectedVersion: number; reason: string }
interface GrowthAdjustInput {
  userId: string
  metric: 'EXPERIENCE' | 'CONTRIBUTION' | 'COIN'
  deltaValue: number
  reason: string
  idempotencyKey?: string
}

const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const PROFILE_REF_PATTERN = /^p1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{48}\.[A-Za-z0-9_-]{22}$/
const IDEMPOTENCY_PATTERN = /^[A-Za-z0-9_.:-]{12,128}$/
const OPPORTUNITY_ROLES = ['connector', 'business_builder', 'capital_operator', 'strategist', 'visual_designer', 'delivery_lead'] as const
export const USER_CONTENT_ROLE_FIELDS: Record<OpportunityRole, readonly string[]> = {
  connector: ['circles', 'resources', 'target'],
  business_builder: ['industries', 'business_models', 'target'],
  capital_operator: ['investment_fields', 'capital_range', 'target'],
  strategist: ['planning_types', 'methods', 'target'],
  visual_designer: ['visual_types', 'portfolio_summary', 'target'],
  delivery_lead: ['project_types', 'delivery_experience', 'target'],
}
const ABILITY_KEYS = ['business_development', 'resource_integration', 'capital_operation', 'strategy_planning', 'visual_design', 'delivery_management'] as const

const textField = (key: string, label: string, maxLength: number, required = true): ContentMutationField => ({ key, label, kind: 'text', maxLength, required })
const areaField = (key: string, label: string, maxLength: number, required = true): ContentMutationField => ({ key, label, kind: 'textarea', maxLength, required })
const selectField = (key: string, label: string, options: readonly string[], required = true): ContentMutationField => ({ key, label, kind: 'select', options, required })
const idField = (key: string, label: string, required = true): ContentMutationField => ({ key, label, kind: 'id', required })
const versionField = (): ContentMutationField => ({ key: 'expectedVersion', label: '记录版本', kind: 'integer', required: true })
const commonVersionFields = (): ContentMutationField[] => [idField('announcementId', '公告', false), versionField()]
const scopeFields = (): ContentMutationField[] => [selectField('scopeType', '作用范围', ['PLATFORM', 'BRANCH']), idField('branchId', '服务器', false)]
const reasonField = (label = '处理原因'): ContentMutationField => areaField('reason', label, 300)

function groupField(key: string, label: string, fields: readonly ContentMutationField[]): ContentMutationField {
  return { key, label, kind: 'group', fields }
}

const USER_CONTENT_FIELDS: ContentMutationField[] = [
  selectField('kind', '内容类型', ['COOPERATION_CARD', 'SUPER_CASE']),
  idField('ownerUserId', '归属用户'),
  idField('contentId', '用户内容', false),
  { ...versionField(), required: false },
  groupField('draft', '内容草稿', [
    { ...selectField('roleKey', '合作角色', [...OPPORTUNITY_ROLES]), visibleWhen: { path: 'kind', value: 'COOPERATION_CARD' } },
    { ...textField('positioning', '合作定位', 500), visibleWhen: { path: 'kind', value: 'COOPERATION_CARD' } },
    { ...textField('targetSummary', '合作目标', 500), visibleWhen: { path: 'kind', value: 'COOPERATION_CARD' } },
    { ...groupField('roleFields', '角色信息', [
      ...roleFields('connector', [['circles', '圈层'], ['resources', '可提供资源'], ['target', '希望对接']]),
      ...roleFields('business_builder', [['industries', '熟悉行业'], ['business_models', '商业模式'], ['target', '合作目标']]),
      ...roleFields('capital_operator', [['investment_fields', '投资领域'], ['capital_range', '资金范围'], ['target', '合作目标']]),
      ...roleFields('strategist', [['planning_types', '策划类型'], ['methods', '工作方法'], ['target', '合作目标']]),
      ...roleFields('visual_designer', [['visual_types', '视觉类型'], ['portfolio_summary', '作品说明'], ['target', '合作目标']]),
      ...roleFields('delivery_lead', [['project_types', '项目类型'], ['delivery_experience', '交付经验'], ['target', '合作目标']]),
    ]), visibleWhen: { path: 'kind', value: 'COOPERATION_CARD' } },
    { ...groupField('abilityScores', '能力评分', [
      ['business_development', '商务拓展'],
      ['resource_integration', '资源整合'],
      ['capital_operation', '资本运作'],
      ['strategy_planning', '战略策划'],
      ['visual_design', '视觉设计'],
      ['delivery_management', '交付管理'],
    ].map(([key, label]) => ({ key, label, kind: 'integer' as const, required: true }))), visibleWhen: { path: 'kind', value: 'COOPERATION_CARD' } },
    { ...textField('projectName', '项目名称', 120), visibleWhen: { path: 'kind', value: 'SUPER_CASE' } },
    { ...textField('summary', '案例摘要', 240), visibleWhen: { path: 'kind', value: 'SUPER_CASE' } },
    { key: 'startedOn', label: '开始日期', kind: 'date', required: false, visibleWhen: { path: 'kind', value: 'SUPER_CASE' } },
    { key: 'endedOn', label: '结束日期', kind: 'date', required: false, visibleWhen: { path: 'kind', value: 'SUPER_CASE' } },
    { ...textField('responsibility', '项目责任', 500), visibleWhen: { path: 'kind', value: 'SUPER_CASE' } },
    { ...idField('cityTagId', '城市标签', false), visibleWhen: { path: 'kind', value: 'SUPER_CASE' } },
    { ...idField('industryTagId', '行业标签', false), visibleWhen: { path: 'kind', value: 'SUPER_CASE' } },
    { ...textField('caseType', '案例类型', 80, false), visibleWhen: { path: 'kind', value: 'SUPER_CASE' } },
    { ...areaField('description', '案例说明', 8_000), visibleWhen: { path: 'kind', value: 'SUPER_CASE' } },
    { ...idField('coverAssetId', '封面素材', false), visibleWhen: { path: 'kind', value: 'SUPER_CASE' } },
    { key: 'mediaAssetIds', label: '案例素材', kind: 'id-list', required: false, visibleWhen: { path: 'kind', value: 'SUPER_CASE' } },
    selectField('status', '内容状态', ['DRAFT', 'PUBLISHED', 'UNPUBLISHED'], false),
  ]),
]

function roleFields(role: OpportunityRole, fields: ReadonlyArray<readonly [string, string]>): ContentMutationField[] {
  return fields.map(([key, label]) => ({
    key,
    label,
    kind: 'textarea',
    required: true,
    maxLength: 1_000,
    visibleWhen: { path: 'draft.roleKey', value: role },
  }))
}

const CONTENT_MUTATION_FORMS: readonly ContentMutationFormDefinition[] = [
  {
    action: 'mip.admin.announcements.save', capability: 'announcements.manage', resource: '公告',
    inputKeys: ['announcementId', 'expectedVersion', 'scopeType', 'branchId', 'title', 'summary', 'body', 'targetType', 'targetId', 'visibleFrom', 'visibleUntil'], idempotencyRequired: false,
    fields: [...scopeFields(), textField('title', '公告标题', 100), areaField('summary', '公告摘要', 240), areaField('body', '公告正文', 5_000), selectField('targetType', '关联类型', ['EVENT', 'OPPORTUNITY'], false), idField('targetId', '关联内容', false), { key: 'visibleFrom', label: '展示开始时间', kind: 'datetime', required: true }, { key: 'visibleUntil', label: '展示结束时间', kind: 'datetime', required: false }],
  },
  { action: 'mip.admin.announcements.publish', capability: 'announcements.manage', resource: '公告', inputKeys: ['announcementId', 'expectedVersion'], idempotencyRequired: false, fields: [idField('announcementId', '公告'), versionField()] },
  { action: 'mip.admin.announcements.withdraw', capability: 'announcements.manage', resource: '公告', inputKeys: ['announcementId', 'expectedVersion', 'reason'], idempotencyRequired: false, fields: [idField('announcementId', '公告'), versionField(), reasonField('撤回原因')] },
  { action: 'mip.admin.announcements.pin', capability: 'announcements.manage', resource: '公告', inputKeys: ['announcementId', 'expectedVersion', 'pinned'], idempotencyRequired: false, fields: [idField('announcementId', '公告'), versionField(), { key: 'pinned', label: '置顶', kind: 'checkbox', required: true }] },
  {
    action: 'mip.admin.messageCampaigns.save', capability: 'messages.manage', resource: '消息活动',
    inputKeys: ['campaignId', 'expectedVersion', 'scopeType', 'branchId', 'audienceType', 'recipientRefs', 'name', 'title', 'body'], idempotencyRequired: false,
    fields: [idField('campaignId', '消息活动', false), { ...versionField(), required: false }, ...scopeFields(), selectField('audienceType', '收件人范围', ['ALL', 'EXPLICIT']), { key: 'recipientRefs', label: '指定收件人', kind: 'profile-ref-list', required: false }, textField('name', '活动名称', 100), textField('title', '消息标题', 100), areaField('body', '消息正文', 500)],
  },
  { action: 'mip.admin.messageCampaigns.snapshot', capability: 'messages.manage', resource: '消息活动', inputKeys: ['campaignId', 'expectedVersion'], idempotencyRequired: false, fields: [idField('campaignId', '消息活动'), versionField()] },
  { action: 'mip.admin.messageCampaigns.schedule', capability: 'messages.manage', resource: '消息活动', inputKeys: ['campaignId', 'expectedVersion', 'expectedDispatchVersion', 'scheduledFor', 'idempotencyKey'], idempotencyRequired: true, fields: [idField('campaignId', '消息活动'), versionField(), { key: 'expectedDispatchVersion', label: '定时计划版本', kind: 'integer', required: false }, { key: 'scheduledFor', label: '定时发布时间（UTC）', kind: 'datetime', required: true }] },
  { action: 'mip.admin.messageCampaigns.cancelSchedule', capability: 'messages.manage', resource: '消息活动', inputKeys: ['campaignId', 'expectedVersion', 'expectedDispatchVersion', 'reason', 'idempotencyKey'], idempotencyRequired: true, fields: [idField('campaignId', '消息活动'), versionField(), { key: 'expectedDispatchVersion', label: '定时计划版本', kind: 'integer', required: true }, reasonField('取消原因')] },
  { action: 'mip.admin.messageCampaigns.publish', capability: 'messages.manage', resource: '消息活动', inputKeys: ['campaignId', 'expectedVersion', 'idempotencyKey'], idempotencyRequired: true, fields: [idField('campaignId', '消息活动'), versionField()] },
  { action: 'mip.admin.messageCampaigns.withdraw', capability: 'messages.manage', resource: '消息活动', inputKeys: ['campaignId', 'expectedVersion', 'reason'], idempotencyRequired: false, fields: [idField('campaignId', '消息活动'), versionField(), reasonField('撤回原因')] },
  { action: 'mip.admin.messageTemplates.save', capability: 'messages.manage', resource: '消息模板', inputKeys: ['templateId', 'expectedVersion', 'scopeType', 'branchId', 'name', 'title', 'body'], idempotencyRequired: false, fields: [idField('templateId', '消息模板', false), { ...versionField(), required: false }, ...scopeFields(), textField('name', '模板名称', 100), textField('title', '消息标题', 100), areaField('body', '消息正文', 500)] },
  { action: 'mip.admin.messageTemplates.activate', capability: 'messages.manage', resource: '消息模板', inputKeys: ['templateId', 'expectedVersion'], idempotencyRequired: false, fields: [idField('templateId', '消息模板'), versionField()] },
  { action: 'mip.admin.messageTemplates.archive', capability: 'messages.manage', resource: '消息模板', inputKeys: ['templateId', 'expectedVersion'], idempotencyRequired: false, fields: [idField('templateId', '消息模板'), versionField()] },
  { action: 'mip.admin.communityReports.claim', capability: 'community.reports.manage', resource: '社区举报', inputKeys: ['reportId', 'expectedVersion', 'reason'], idempotencyRequired: false, fields: [idField('reportId', '社区举报'), versionField(), reasonField()] },
  { action: 'mip.admin.communityReports.close', capability: 'community.reports.manage', resource: '社区举报', inputKeys: ['reportId', 'expectedVersion', 'outcome', 'reason'], idempotencyRequired: false, fields: [idField('reportId', '社区举报'), versionField(), selectField('outcome', '处理结果', ['RESOLVED', 'DISMISSED']), reasonField()] },
  {
    action: 'mip.admin.opportunities.save', capability: 'opportunities.moderate', resource: '机会',
    inputKeys: ['opportunityId', 'expectedVersion', 'draft'], idempotencyRequired: false,
    fields: [idField('opportunityId', '机会', false), { ...versionField(), required: false }, groupField('draft', '机会草稿', [idField('ownerUserId', '发布人'), ...scopeFields(), textField('title', '机会标题', 120), textField('valueSummary', '机会价值', 300), textField('targetSummary', '合作目标', 300, false), areaField('description', '机会说明', 5_000, false), idField('cityTagId', '城市标签', false), groupField('commercialTerms', '商业条件', [{ key: 'minAmountCents', label: '最低金额（分）', kind: 'integer', required: false }, { key: 'maxAmountCents', label: '最高金额（分）', kind: 'integer', required: false }, { key: 'locations', label: '合作地点', kind: 'group', required: true }]), { key: 'roleKeys', label: '合作角色', kind: 'select', options: OPPORTUNITY_ROLES }, { key: 'tagIds', label: '标签', kind: 'id-list', required: false }, { key: 'deadlineAt', label: '截止时间', kind: 'datetime', required: false }])],
  },
  { action: 'mip.admin.opportunities.publish', capability: 'opportunities.moderate', resource: '机会', inputKeys: ['opportunityId', 'expectedVersion'], idempotencyRequired: false, fields: [idField('opportunityId', '机会'), versionField()] },
  { action: 'mip.admin.opportunities.end', capability: 'opportunities.moderate', resource: '机会', inputKeys: ['opportunityId', 'expectedVersion'], idempotencyRequired: false, fields: [idField('opportunityId', '机会'), versionField()] },
  { action: 'mip.admin.opportunities.unpublish', capability: 'opportunities.moderate', resource: '机会', inputKeys: ['opportunityId', 'expectedVersion', 'reason'], idempotencyRequired: false, fields: [idField('opportunityId', '机会'), versionField(), reasonField('下架原因')] },
  { action: 'mip.admin.opportunities.archive', capability: 'opportunities.archive', resource: '机会', inputKeys: ['opportunityId', 'expectedVersion', 'reason'], idempotencyRequired: false, fields: [idField('opportunityId', '机会'), versionField(), reasonField('归档原因')] },
  { action: 'mip.admin.userContent.save', capability: 'userContent.moderate', resource: '用户内容', inputKeys: ['kind', 'contentId', 'expectedVersion', 'ownerUserId', 'draft'], idempotencyRequired: false, fields: USER_CONTENT_FIELDS },
  { action: 'mip.admin.userContent.unpublish', capability: 'userContent.moderate', resource: '用户内容', inputKeys: ['kind', 'contentId', 'expectedVersion', 'reason'], idempotencyRequired: false, fields: [selectField('kind', '内容类型', ['COOPERATION_CARD', 'SUPER_CASE']), idField('contentId', '用户内容'), versionField(), reasonField('下架原因')] },
  { action: 'mip.admin.userContent.archive', capability: 'userContent.moderate', resource: '用户内容', inputKeys: ['kind', 'contentId', 'expectedVersion', 'reason'], idempotencyRequired: false, fields: [selectField('kind', '内容类型', ['COOPERATION_CARD', 'SUPER_CASE']), idField('contentId', '用户内容'), versionField(), reasonField('归档原因')] },
  {
    action: 'mip.admin.knowledge.contents.save', capability: 'knowledge.manage', resource: '知识内容', inputKeys: ['contentId', 'expectedVersion', 'sourceId', 'categoryId', 'contentType', 'title', 'summary', 'bodyText', 'externalUrl', 'channelFinderUserName', 'channelFeedId', 'coverAssetId', 'authorName', 'accessType', 'commentsEnabled', 'moderationMode'], idempotencyRequired: false,
    fields: [idField('contentId', '知识内容', false), { ...versionField(), required: false }, idField('sourceId', '信息源', false), idField('categoryId', '分类'), selectField('contentType', '内容类型', ['HOT_NEWS', 'ARTICLE', 'WEB', 'VIDEO', 'PRIVATE_CHANNEL', 'EXPERT_SHARE']), textField('title', '标题', 160), areaField('summary', '摘要', 500), areaField('bodyText', '正文', 100_000, false), { key: 'externalUrl', label: '外部地址', kind: 'url', required: false }, textField('channelFinderUserName', '视频号用户名', 64, false), textField('channelFeedId', '视频号 Feed ID', 128, false), idField('coverAssetId', '封面素材', false), textField('authorName', '作者', 100, false), selectField('accessType', '访问范围', ['FREE', 'MEMBER', 'MEMBER_OR_PAID']), { key: 'commentsEnabled', label: '允许评论', kind: 'checkbox', required: true }, selectField('moderationMode', '评论审核方式', ['AUTO', 'REVIEW'])],
  },
  { action: 'mip.admin.knowledge.contents.review', capability: 'knowledge.manage', resource: '知识内容', inputKeys: ['contentId', 'expectedVersion', 'decision', 'reason'], idempotencyRequired: false, fields: [idField('contentId', '知识内容'), versionField(), selectField('decision', '审核操作', ['SUBMIT', 'APPROVE', 'REJECT', 'PUBLISH', 'WITHDRAW']), reasonField('审核原因')] },
  { action: 'mip.admin.knowledge.schedules.save', capability: 'knowledge.manage', resource: '知识采集计划', inputKeys: ['scheduleId', 'expectedVersion', 'sourceId', 'categoryId', 'dailyTime', 'timeZone', 'status', 'idempotencyKey'], idempotencyRequired: true, fields: [idField('scheduleId', '采集计划', false), { ...versionField(), required: false }, idField('sourceId', '信息源'), idField('categoryId', '分类'), { key: 'dailyTime', label: '每日时间', kind: 'time', required: true }, textField('timeZone', '时区', 64), selectField('status', '计划状态', ['ACTIVE', 'PAUSED'], false)] },
  { action: 'mip.admin.badges.grant', capability: 'badges.manage', resource: '用户勋章', inputKeys: ['userId', 'badgeId', 'reason'], idempotencyRequired: false, fields: [idField('userId', '用户'), idField('badgeId', '勋章'), reasonField('授予原因')] },
  { action: 'mip.admin.badges.revoke', capability: 'badges.manage', resource: '用户勋章', inputKeys: ['awardId', 'expectedVersion', 'reason'], idempotencyRequired: false, fields: [idField('awardId', '获授记录'), versionField(), reasonField('撤销原因')] },
  { action: 'mip.admin.growth.adjust', capability: 'growth.adjust', resource: '成长流水', inputKeys: ['userId', 'metric', 'deltaValue', 'reason', 'idempotencyKey'], idempotencyRequired: true, fields: [idField('userId', '用户'), selectField('metric', '成长类型', ['EXPERIENCE', 'CONTRIBUTION', 'COIN']), { key: 'deltaValue', label: '调整数值', kind: 'integer', required: true }, reasonField('调整原因')] },
]

const FORM_BY_ACTION = new Map(CONTENT_MUTATION_FORMS.map(form => [form.action, form]))

/** Alias for consumers that want a keyed manifest instead of a list. */
export const ADMIN_CONTENT_MUTATION_CONFIG: Readonly<Record<ContentMutationAction, ContentMutationFormDefinition>> = Object.fromEntries(
  CONTENT_MUTATION_FORMS.map(form => [form.action, form]),
) as Readonly<Record<ContentMutationAction, ContentMutationFormDefinition>>

export function listContentMutationForms(): readonly ContentMutationFormDefinition[] {
  return CONTENT_MUTATION_FORMS
}

export function getContentMutationForm(action: ContentMutationAction): ContentMutationFormDefinition {
  const form = FORM_BY_ACTION.get(action)
  if (!form) throw new Error(`Unknown content mutation action: ${action}`)
  return form
}

export function validateContentMutation(action: ContentMutationAction, value: unknown): ContentMutationValidation {
  try {
    return { ok: true, input: validateInput(action, value) as AdminRequestInput }
  }
  catch (error) {
    const message = error instanceof Error ? error.message : '提交内容无效'
    return { ok: false, errors: { form: message } }
  }
}

export function createContentMutationIntent(
  action: ContentMutationAction,
  value: unknown,
  idempotencyKey = createContentMutationIdempotencyKey(action),
): ContentMutationIntent {
  const form = getContentMutationForm(action)
  const result = validateContentMutation(action, value)
  if (!result.ok) throw new TypeError(Object.values(result.errors).join('；'))
  if (!form.idempotencyRequired) return { action, input: result.input }
  const key = String(idempotencyKey).trim()
  if (!IDEMPOTENCY_PATTERN.test(key)) {
    throw new TypeError('幂等标识格式无效')
  }
  return { action, idempotencyKey: key, input: { ...result.input, idempotencyKey: key } }
}

export function createContentMutationIdempotencyKey(action: ContentMutationAction): string {
  const suffix = globalThis.crypto?.randomUUID?.().replaceAll('-', '') || `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`
  return `web-${action.split('.').at(-1) || 'mutation'}-${suffix}`.slice(0, 128)
}

function validateInput(action: ContentMutationAction, value: unknown): unknown {
  const input = record(value)
  assertAllowedInputKeys(action, input)
  switch (action) {
    case 'mip.admin.announcements.save': return validateAnnouncement(input)
    case 'mip.admin.announcements.publish': return validateVersionAction(input, 'announcementId', '公告')
    case 'mip.admin.announcements.withdraw': return { ...validateVersionAction(input, 'announcementId', '公告'), reason: requiredText(input.reason, 300, '撤回原因') }
    case 'mip.admin.announcements.pin': return { ...validateVersionAction(input, 'announcementId', '公告'), pinned: boolean(input.pinned, '置顶状态') }
    case 'mip.admin.messageCampaigns.save': return validateCampaign(input)
    case 'mip.admin.messageCampaigns.snapshot': return validateVersionAction(input, 'campaignId', '消息活动')
    case 'mip.admin.messageCampaigns.schedule': return validateSchedule(input)
    case 'mip.admin.messageCampaigns.cancelSchedule': return { ...validateScheduleVersion(input), reason: requiredText(input.reason, 300, '取消原因') }
    case 'mip.admin.messageCampaigns.publish': return { ...validateVersionAction(input, 'campaignId', '消息活动'), ...optionalIdempotency(input.idempotencyKey) }
    case 'mip.admin.messageCampaigns.withdraw': return { ...validateVersionAction(input, 'campaignId', '消息活动'), reason: requiredText(input.reason, 300, '撤回原因') }
    case 'mip.admin.messageTemplates.save': return validateTemplate(input)
    case 'mip.admin.messageTemplates.activate': return validateVersionAction(input, 'templateId', '消息模板')
    case 'mip.admin.messageTemplates.archive': return validateVersionAction(input, 'templateId', '消息模板')
    case 'mip.admin.communityReports.claim': return { ...validateVersionAction(input, 'reportId', '社区举报'), reason: requiredText(input.reason, 300, '处理原因') }
    case 'mip.admin.communityReports.close': {
      const base = validateVersionAction(input, 'reportId', '社区举报')
      const outcome = enumValue(input.outcome, ['RESOLVED', 'DISMISSED'], '处理结果')
      return { ...base, outcome, reason: requiredText(input.reason, 300, '处理原因') }
    }
    case 'mip.admin.opportunities.save': return validateOpportunity(input)
    case 'mip.admin.opportunities.publish': return validateVersionAction(input, 'opportunityId', '机会')
    case 'mip.admin.opportunities.end': return validateVersionAction(input, 'opportunityId', '机会')
    case 'mip.admin.opportunities.unpublish': return { ...validateVersionAction(input, 'opportunityId', '机会'), reason: requiredText(input.reason, 240, '下架原因') }
    case 'mip.admin.opportunities.archive': return { ...validateVersionAction(input, 'opportunityId', '机会'), reason: requiredText(input.reason, 240, '归档原因') }
    case 'mip.admin.userContent.save': return validateUserContent(input)
    case 'mip.admin.userContent.unpublish': return validateContentReason(input, '下架原因')
    case 'mip.admin.userContent.archive': return validateContentReason(input, '归档原因')
    case 'mip.admin.knowledge.contents.save': return validateKnowledgeContent(input)
    case 'mip.admin.knowledge.contents.review': return validateKnowledgeReview(input)
    case 'mip.admin.knowledge.schedules.save': return validateKnowledgeSchedule(input)
    case 'mip.admin.badges.grant': return { userId: requiredId(input.userId, '用户'), badgeId: requiredId(input.badgeId, '勋章'), reason: requiredText(input.reason, 300, '授予原因') }
    case 'mip.admin.badges.revoke': return { ...validateVersionAction(input, 'awardId', '获授记录'), reason: requiredText(input.reason, 300, '撤销原因') }
    case 'mip.admin.growth.adjust': return validateGrowthAdjust(input)
  }
}

function assertAllowedInputKeys(action: ContentMutationAction, input: Record<string, unknown>) {
  const allowed = new Set(getContentMutationForm(action).inputKeys)
  if (Object.keys(input).some(key => !allowed.has(key))) throw invalid('提交字段无效')
}

function validateAnnouncement(input: Record<string, unknown>): AnnouncementInput {
  assertKeys(input, ['announcementId', 'expectedVersion', 'scopeType', 'branchId', 'title', 'summary', 'body', 'targetType', 'targetId', 'visibleFrom', 'visibleUntil'])
  const result = { ...optionalIdVersion(input, 'announcementId', '公告'), ...scope(input), title: requiredText(input.title, 100, '公告标题'), summary: requiredText(input.summary, 240, '公告摘要'), body: requiredText(input.body, 5_000, '公告正文'), visibleFrom: requiredDate(input.visibleFrom, '展示开始时间') } as AnnouncementInput
  const targetType = optionalEnum(input.targetType, ['EVENT', 'OPPORTUNITY'])
  const targetId = optionalId(input.targetId, '关联内容')
  if (Boolean(targetType) !== Boolean(targetId)) throw invalid('公告关联内容无效')
  if (targetType) result.targetType = targetType as AnnouncementTarget
  if (targetId) result.targetId = targetId
  const visibleUntil = optionalDate(input.visibleUntil, '展示结束时间')
  if (visibleUntil && new Date(visibleUntil) <= new Date(result.visibleFrom)) throw invalid('展示结束时间必须晚于开始时间')
  if (visibleUntil) result.visibleUntil = visibleUntil
  return result
}

function validateCampaign(input: Record<string, unknown>): MessageCampaignInput {
  assertKeys(input, ['campaignId', 'expectedVersion', 'scopeType', 'branchId', 'audienceType', 'recipientRefs', 'name', 'title', 'body'])
  const result = { ...optionalIdVersion(input, 'campaignId', '消息活动'), ...scope(input), audienceType: enumValue(input.audienceType, ['ALL', 'EXPLICIT'], '收件人范围'), recipientRefs: [] as string[], name: requiredText(input.name, 100, '活动名称'), title: requiredText(input.title, 100, '消息标题'), body: requiredText(input.body, 500, '消息正文') } as MessageCampaignInput
  if (result.audienceType === 'EXPLICIT') result.recipientRefs = profileRefs(input.recipientRefs)
  else if (input.recipientRefs !== undefined && !Array.isArray(input.recipientRefs)) throw invalid('收件人信息无效')
  return result
}

function validateTemplate(input: Record<string, unknown>): MessageTemplateInput {
  assertKeys(input, ['templateId', 'expectedVersion', 'scopeType', 'branchId', 'name', 'title', 'body'])
  return { ...optionalIdVersion(input, 'templateId', '消息模板'), ...scope(input), name: requiredText(input.name, 100, '模板名称'), title: requiredText(input.title, 100, '消息标题'), body: requiredText(input.body, 500, '消息正文') }
}

function validateOpportunity(input: Record<string, unknown>): OpportunityInput {
  const draft = record(input.draft)
  assertKeys(draft, ['ownerUserId', 'scopeType', 'branchId', 'title', 'valueSummary', 'targetSummary', 'description', 'cityTagId', 'commercialTerms', 'roleKeys', 'tagIds', 'deadlineAt'])
  const roles = stringList(draft.roleKeys, 6, '合作角色')
  if (roles.some(item => !(OPPORTUNITY_ROLES as readonly string[]).includes(item))) throw invalid('合作角色无效')
  const tagIds = idList(draft.tagIds, 20, '标签')
  const commercialTerms = validateCommercialTerms(draft.commercialTerms)
  return { ...optionalIdVersion(input, 'opportunityId', '机会'), draft: { ownerUserId: requiredId(draft.ownerUserId, '发布人'), ...scope(draft), title: requiredText(draft.title, 120, '机会标题'), valueSummary: requiredText(draft.valueSummary, 300, '机会价值'), targetSummary: optionalText(draft.targetSummary, 300), description: optionalText(draft.description, 5_000), cityTagId: optionalId(draft.cityTagId, '城市'), commercialTerms, roleKeys: roles as OpportunityRole[], tagIds, deadlineAt: optionalDateTime(draft.deadlineAt, '截止时间') } }
}

function validateCommercialTerms(value: unknown): CommercialTerms | null | undefined {
  if (value === undefined) return undefined
  if (value === null) return null
  const terms = record(value)
  assertKeys(terms, ['currency', 'amountUnit', 'minAmountCents', 'maxAmountCents', 'locations'])
  const min = optionalInteger(terms.minAmountCents, '最低金额')
  const max = optionalInteger(terms.maxAmountCents, '最高金额')
  if (min !== undefined && min < 0 || max !== undefined && max < 0 || min !== undefined && max !== undefined && min > max) throw invalid('商业金额无效')
  const locations = terms.locations === undefined ? [] : Array.isArray(terms.locations) ? terms.locations.map(location => {
    const item = record(location)
    const type = enumValue(item.type, ['CITY', 'NATIONAL', 'REMOTE'], '合作地点') as CommercialLocation['type']
    const cityTagId = optionalId(item.cityTagId, '城市标签')
    if (type === 'CITY' && !cityTagId) throw invalid('城市合作地点无效')
    if (type !== 'CITY' && cityTagId) throw invalid('合作地点无效')
    return cityTagId ? { type, cityTagId } : { type }
  }) : (() => { throw invalid('合作地点无效') })()
  if (locations.length > 16) throw invalid('合作地点过多')
  return { currency: 'CNY', amountUnit: 'CNY_CENTS', minAmountCents: min ?? null, maxAmountCents: max ?? null, locations }
}

function validateUserContent(input: Record<string, unknown>): UserContentSaveInput {
  const kind = enumValue(input.kind, ['COOPERATION_CARD', 'SUPER_CASE'], '内容类型') as ContentKind
  const ownerUserId = requiredId(input.ownerUserId, '归属用户')
  const contentId = optionalId(input.contentId, '用户内容')
  const expectedVersion = contentId ? positiveVersion(input.expectedVersion) : undefined
  const draft = record(input.draft)
  if (kind === 'COOPERATION_CARD') return { kind, ownerUserId, ...(contentId ? { contentId, expectedVersion } : {}), draft: validateCardDraft(draft) }
  return { kind, ownerUserId, ...(contentId ? { contentId, expectedVersion } : {}), draft: validateCaseDraft(draft) }
}

function validateCardDraft(draft: Record<string, unknown>): CooperationCardDraft {
  assertKeys(draft, ['kind', 'roleKey', 'positioning', 'targetSummary', 'roleFields', 'abilityScores', 'status'])
  if (draft.kind !== 'COOPERATION_CARD') throw invalid('合作卡草稿无效')
  const roleKey = enumValue(draft.roleKey, OPPORTUNITY_ROLES, '合作角色') as OpportunityRole
  const fields = record(draft.roleFields)
  const required = USER_CONTENT_ROLE_FIELDS[roleKey]
  if (Object.keys(fields).some(key => !required.includes(key)) || required.some(key => !(key in fields))) throw invalid('合作卡信息无效')
  for (const key of required) {
    const value = fields[key]
    if (Array.isArray(value)) { if (!value.length || value.length > 12 || value.some(item => typeof item !== 'string' || !item.trim() || item.length > 80)) throw invalid('合作卡信息无效') }
    else if (typeof value !== 'string' || !value.trim() || value.length > 1_000) throw invalid('合作卡信息无效')
  }
  const scores = record(draft.abilityScores)
  if (Object.keys(scores).length !== ABILITY_KEYS.length || ABILITY_KEYS.some(key => !Object.hasOwn(scores, key))) throw invalid('能力评分无效')
  for (const key of ABILITY_KEYS) { const score = integer(scores[key], '能力评分'); if (score < 0 || score > 5) throw invalid('能力评分无效') }
  return { kind: 'COOPERATION_CARD', roleKey, positioning: requiredText(draft.positioning, 500, '合作定位'), targetSummary: requiredText(draft.targetSummary, 500, '合作目标'), roleFields: fields as CooperationCardDraft['roleFields'], abilityScores: scores as Record<string, number>, status: optionalEnum(draft.status, ['DRAFT', 'PUBLISHED', 'UNPUBLISHED']) as CooperationCardDraft['status'] }
}

function validateCaseDraft(draft: Record<string, unknown>): SuperCaseDraft {
  assertKeys(draft, ['kind', 'projectName', 'summary', 'startedOn', 'endedOn', 'responsibility', 'cityTagId', 'industryTagId', 'caseType', 'description', 'coverAssetId', 'mediaAssetIds', 'status'])
  if (draft.kind !== 'SUPER_CASE') throw invalid('案例草稿无效')
  const startedOn = optionalDateOnly(draft.startedOn, '开始日期')
  const endedOn = optionalDateOnly(draft.endedOn, '结束日期')
  if (startedOn && endedOn && endedOn < startedOn) throw invalid('案例日期无效')
  const mediaAssetIds = draft.mediaAssetIds === undefined ? [] : idList(draft.mediaAssetIds, 12, '案例素材', true)
  for (const key of ['cityTagId', 'industryTagId', 'coverAssetId']) { const value = draft[key]; if (value !== undefined && value !== null && !UUID_PATTERN.test(String(value))) throw invalid('案例素材无效') }
  if (mediaAssetIds.some(id => !UUID_PATTERN.test(id))) throw invalid('案例素材无效')
  return { kind: 'SUPER_CASE', projectName: requiredText(draft.projectName, 120, '项目名称'), summary: requiredText(draft.summary, 240, '案例摘要'), startedOn, endedOn, responsibility: requiredText(draft.responsibility, 500, '项目责任'), cityTagId: draft.cityTagId ? String(draft.cityTagId) : null, industryTagId: draft.industryTagId ? String(draft.industryTagId) : null, caseType: optionalText(draft.caseType, 80), description: requiredText(draft.description, 8_000, '案例说明'), coverAssetId: draft.coverAssetId ? String(draft.coverAssetId) : null, mediaAssetIds, status: optionalEnum(draft.status, ['DRAFT', 'PUBLISHED', 'UNPUBLISHED']) as SuperCaseDraft['status'] }
}

function validateKnowledgeContent(input: Record<string, unknown>): KnowledgeContentInput {
  assertKeys(input, ['contentId', 'expectedVersion', 'sourceId', 'categoryId', 'contentType', 'title', 'summary', 'bodyText', 'externalUrl', 'channelFinderUserName', 'channelFeedId', 'coverAssetId', 'authorName', 'accessType', 'commentsEnabled', 'moderationMode'])
  const contentId = optionalUuid(input.contentId, '知识内容')
  const contentType = enumValue(input.contentType, ['HOT_NEWS', 'ARTICLE', 'WEB', 'VIDEO', 'PRIVATE_CHANNEL', 'EXPERT_SHARE'], '内容类型') as KnowledgeContentInput['contentType']
  const bodyText = optionalText(input.bodyText, 100_000)
  const externalUrl = optionalUrl(input.externalUrl, '外部地址')
  if (['ARTICLE', 'HOT_NEWS', 'EXPERT_SHARE'].includes(contentType) && !bodyText) throw invalid('请填写正文')
  if (['WEB', 'VIDEO'].includes(contentType) && !externalUrl) throw invalid('请填写外部地址')
  const finder = optionalAscii(input.channelFinderUserName, 64)
  const feed = optionalAscii(input.channelFeedId, 128)
  if (contentType === 'PRIVATE_CHANNEL' && (!finder || !feed)) throw invalid('私域频道信息无效')
  return { ...(contentId ? { contentId, expectedVersion: positiveVersion(input.expectedVersion) } : {}), sourceId: optionalUuid(input.sourceId, '信息源'), categoryId: uuid(input.categoryId, '分类'), contentType, title: requiredText(input.title, 160, '标题'), summary: requiredText(input.summary, 500, '摘要'), bodyText, externalUrl, channelFinderUserName: contentType === 'PRIVATE_CHANNEL' ? finder : undefined, channelFeedId: contentType === 'PRIVATE_CHANNEL' ? feed : undefined, coverAssetId: optionalUuid(input.coverAssetId, '封面素材'), authorName: optionalText(input.authorName, 100), accessType: enumValue(input.accessType, ['FREE', 'MEMBER', 'MEMBER_OR_PAID'], '访问范围') as KnowledgeContentInput['accessType'], commentsEnabled: boolean(input.commentsEnabled, '评论开关'), moderationMode: enumValue(input.moderationMode, ['AUTO', 'REVIEW'], '评论审核方式') as KnowledgeContentInput['moderationMode'] }
}

function validateKnowledgeReview(input: Record<string, unknown>): KnowledgeReviewInput {
  assertKeys(input, ['contentId', 'expectedVersion', 'decision', 'reason'])
  const decision = enumValue(input.decision, ['SUBMIT', 'APPROVE', 'REJECT', 'PUBLISH', 'WITHDRAW'], '审核操作') as KnowledgeReviewInput['decision']
  const reason = optionalText(input.reason, 300)
  if (['REJECT', 'WITHDRAW'].includes(decision) && !reason) throw invalid('请填写审核原因')
  return { contentId: uuid(input.contentId, '知识内容'), expectedVersion: positiveVersion(input.expectedVersion), decision, reason }
}

function validateKnowledgeSchedule(input: Record<string, unknown>): KnowledgeScheduleInput {
  assertKeys(input, ['scheduleId', 'expectedVersion', 'sourceId', 'categoryId', 'dailyTime', 'timeZone', 'status', 'idempotencyKey'])
  const scheduleId = optionalUuid(input.scheduleId, '采集计划')
  const expectedVersion = scheduleId ? positiveVersion(input.expectedVersion) : 0
  const dailyTime = requiredTime(input.dailyTime)
  const timeZone = requiredText(input.timeZone, 64, '时区')
  if (!/^[-+A-Za-z0-9_./]+$/.test(timeZone)) throw invalid('时区无效')
  return { ...(scheduleId ? { scheduleId, expectedVersion } : {}), sourceId: uuid(input.sourceId, '信息源'), categoryId: uuid(input.categoryId, '分类'), dailyTime, timeZone, status: optionalEnum(input.status, ['ACTIVE', 'PAUSED']) as KnowledgeScheduleInput['status'] || 'ACTIVE', ...optionalIdempotency(input.idempotencyKey) }
}

function validateGrowthAdjust(input: Record<string, unknown>): GrowthAdjustInput {
  const deltaValue = integer(input.deltaValue, '调整数值')
  if (!deltaValue || Math.abs(deltaValue) > 1_000_000) throw invalid('调整数值无效')
  return { userId: requiredId(input.userId, '用户'), metric: enumValue(input.metric, ['EXPERIENCE', 'CONTRIBUTION', 'COIN'], '成长类型') as GrowthAdjustInput['metric'], deltaValue, reason: requiredText(input.reason, 300, '调整原因'), ...optionalIdempotency(input.idempotencyKey) }
}

function validateContentReason(input: Record<string, unknown>, label: string): ContentReasonInput {
  return { kind: enumValue(input.kind, ['COOPERATION_CARD', 'SUPER_CASE'], '内容类型') as ContentKind, contentId: requiredId(input.contentId, '用户内容'), expectedVersion: positiveVersion(input.expectedVersion), reason: requiredText(input.reason, 300, label) }
}

function validateSchedule(input: Record<string, unknown>): MessageCampaignScheduleInput {
  const expectedDispatchVersion = input.expectedDispatchVersion === undefined || input.expectedDispatchVersion === null || input.expectedDispatchVersion === ''
    ? undefined
    : positiveVersion(input.expectedDispatchVersion)
  return { campaignId: requiredId(input.campaignId, '消息活动'), expectedVersion: positiveVersion(input.expectedVersion), ...(expectedDispatchVersion === undefined ? {} : { expectedDispatchVersion }), scheduledFor: requiredUtcDate(input.scheduledFor), ...optionalIdempotency(input.idempotencyKey) }
}

function validateScheduleVersion(input: Record<string, unknown>): MessageCampaignVersionInput & { expectedDispatchVersion: number } {
  return { campaignId: requiredId(input.campaignId, '消息活动'), expectedVersion: positiveVersion(input.expectedVersion), expectedDispatchVersion: positiveVersion(input.expectedDispatchVersion) }
}

function validateVersionAction(input: Record<string, unknown>, idKey: string, label: string) {
  return { [idKey]: requiredId(input[idKey], label), expectedVersion: positiveVersion(input.expectedVersion) }
}

function optionalIdVersion(input: Record<string, unknown>, key: string, label: string) {
  const id = optionalId(input[key], label)
  if (!id) return {}
  return { [key]: id, expectedVersion: positiveVersion(input.expectedVersion) }
}

function scope(input: Record<string, unknown>) {
  const scopeType = enumValue(input.scopeType, ['PLATFORM', 'BRANCH'], '作用范围') as ScopeType
  const branchId = optionalId(input.branchId, '服务器')
  if (scopeType === 'BRANCH' && !branchId) throw invalid('服务器不能为空')
  if (scopeType === 'PLATFORM' && branchId) throw invalid('平台范围不能填写服务器')
  return scopeType === 'BRANCH' ? { scopeType, branchId } : { scopeType }
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid('提交内容无效')
  return value as Record<string, unknown>
}

function assertKeys(value: Record<string, unknown>, allowedKeys: readonly string[]) {
  const allowed = new Set(allowedKeys)
  if (Object.keys(value).some(key => !allowed.has(key))) throw invalid('提交字段无效')
}

function invalid(message: string): Error { return new Error(message) }

function requiredId(value: unknown, label: string): string {
  const id = optionalId(value, label)
  if (!id) throw invalid(`${label}标识无效`)
  return id
}

function optionalId(value: unknown, _label: string): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  const id = typeof value === 'string' ? value.trim() : ''
  if (!ID_PATTERN.test(id)) throw invalid('标识无效')
  return id
}

function uuid(value: unknown, label: string): string {
  const result = typeof value === 'string' ? value.trim() : ''
  if (!UUID_PATTERN.test(result)) throw invalid(`${label}标识无效`)
  return result
}

function optionalUuid(value: unknown, label: string): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  return uuid(value, label)
}

function requiredText(value: unknown, maximum: number, label: string): string {
  const text = optionalText(value, maximum)
  if (!text) throw invalid(`${label}格式无效`)
  return text
}

function optionalText(value: unknown, maximum: number): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  const text = typeof value === 'string' ? value.normalize('NFKC').trim().replace(/\s+/g, ' ') : ''
  if (!text || text.length > maximum) throw invalid('文本格式无效')
  return text
}

function integer(value: unknown, label: string): number {
  const result = Number(value)
  if (!Number.isSafeInteger(result)) throw invalid(`${label}无效`)
  return result
}

function optionalInteger(value: unknown, label: string): number | undefined {
  if (value === undefined || value === null || value === '') return undefined
  return integer(value, label)
}

function positiveVersion(value: unknown): number {
  const version = integer(value, '记录版本')
  if (version < 1) throw invalid('记录版本无效')
  return version
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw invalid(`${label}无效`)
  return value
}

function enumValue<T extends string>(value: unknown, options: readonly T[], label: string): T {
  if (typeof value !== 'string' || !options.includes(value as T)) throw invalid(`${label}无效`)
  return value as T
}

function optionalEnum<T extends string>(value: unknown, options: readonly T[]): T | undefined {
  if (value === undefined || value === null || value === '') return undefined
  return enumValue(value, options, '枚举值')
}

function stringList(value: unknown, maximum: number, label: string): string[] {
  if (!Array.isArray(value) || value.length > maximum) throw invalid(`${label}无效`)
  const result = [...new Set(value.map(item => typeof item === 'string' ? item.trim() : ''))]
  if (result.length !== value.length || result.some(item => !item)) throw invalid(`${label}无效`)
  return result
}

function idList(value: unknown, maximum: number, label: string, required = false): string[] {
  if (value === undefined && !required) return []
  if (!Array.isArray(value) || value.length > maximum) throw invalid(`${label}无效`)
  return value.map(item => requiredId(item, label))
}

function profileRefs(value: unknown): string[] {
  if (!Array.isArray(value) || !value.length || value.length > 100) throw invalid('请选择 1 至 100 个收件人')
  const refs = value.map(item => typeof item === 'string' ? item.trim() : '')
  if (new Set(refs).size !== refs.length || refs.some(item => !PROFILE_REF_PATTERN.test(item))) throw invalid('收件人信息无效')
  return refs
}

function optionalDate(value: unknown, label: string): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  const date = new Date(String(value))
  if (!Number.isFinite(date.getTime())) throw invalid(`${label}无效`)
  return date.toISOString()
}

function requiredDate(value: unknown, label: string): string {
  const date = optionalDate(value, label)
  if (!date) throw invalid(`请填写${label}`)
  return date
}

function optionalDateTime(value: unknown, label: string): string | undefined { return optionalDate(value, label) }

function optionalDateOnly(value: unknown, label: string): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw invalid(`${label}无效`)
  const parsed = new Date(`${value}T00:00:00Z`)
  if (!Number.isFinite(parsed.getTime())) throw invalid(`${label}无效`)
  return value
}

function requiredUtcDate(value: unknown): string {
  const source = typeof value === 'string' ? value.trim() : ''
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(source)) throw invalid('定时发布时间必须使用 UTC 时间')
  const date = new Date(source)
  if (!Number.isFinite(date.getTime()) || date.getUTCFullYear() >= 2100) throw invalid('定时发布时间无效')
  return date.toISOString()
}

function requiredTime(value: unknown): string {
  const result = typeof value === 'string' ? value.trim() : ''
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(result)) throw invalid('每日时间无效')
  return result
}

function optionalUrl(value: unknown, label: string): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string' || !/^https:\/\//.test(value.trim())) throw invalid(`${label}无效`)
  try { new URL(value.trim()) } catch { throw invalid(`${label}无效`) }
  return value.trim()
}

function optionalAscii(value: unknown, maximum: number): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  const result = typeof value === 'string' ? value.trim() : ''
  if (!result || result.length > maximum || !/^[A-Za-z0-9_@.-]+$/.test(result)) throw invalid('标识格式无效')
  return result
}

function idempotency(value: unknown): string {
  const key = typeof value === 'string' ? value.trim() : ''
  if (!IDEMPOTENCY_PATTERN.test(key)) throw invalid('幂等标识格式无效')
  return key
}

function optionalIdempotency(value: unknown): { idempotencyKey?: string } {
  return value === undefined || value === null || value === '' ? {} : { idempotencyKey: idempotency(value) }
}
