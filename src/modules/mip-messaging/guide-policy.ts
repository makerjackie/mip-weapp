import type { SubscriptionDecision } from './types'

/**
 * 订阅授权引导层弹出节奏（MIW-40 D2，机会发布人侧）。
 * 纯函数：不触 wx、不触网；组件负责存储与手势。决策口径——
 * TEMPLATE_MISSING / 已入账 / BANNED / 拒绝封顶 / 24h 内已展示 → 不出层；
 * 拒绝过但未封顶 → 只出手动开启文案（D4：原生面板不再重复拉起）；
 * 其余 → 出「开启提醒」引导层（原生面板仅在层内按钮 tap 手势中调用）。
 */
export type SubscriptionGuidePresentation = 'REQUEST' | 'MANUAL' | 'HIDDEN'

export interface SubscriptionGuideRecord {
  /** 引导层最近一次展示时间（epoch ms），键为机会 ID；只保留最近 GUIDE_RECORD_LIMIT 条。 */
  shownAtByOpportunity: Record<string, number>
  /** 原生面板 REJECTED 决策累计数，键为模板键。 */
  rejectedCountByTemplate: Record<string, number>
  /** 终态决策：ACCEPTED=已入账后隐藏、BANNED=永久隐藏；REJECTED 不入此表。 */
  decidedTemplates: Record<string, Exclude<SubscriptionDecision, 'REJECTED'>>
}

export interface SubscriptionGuidePolicyInput {
  templateKey: string
  opportunityId: string
  now: number
  capabilityAvailable: boolean
  /** 同一机会两次展示的最小间隔；缺省 24 小时（D2）。 */
  shownWithinMs?: number
  /** REJECTED 累计封顶次数；缺省 3 次（D2）。 */
  rejectionCap?: number
}

export interface SubscriptionGuideOutcome {
  presentation: SubscriptionGuidePresentation
  reason:
    | 'TEMPLATE_MISSING'
    | 'ACCEPTED'
    | 'BANNED'
    | 'REJECTION_CAP'
    | 'SHOWN_RECENTLY'
    | 'REJECTED'
    | 'ELIGIBLE'
}

export const GUIDE_SHOWN_INTERVAL_MS = 24 * 60 * 60 * 1000
export const GUIDE_REJECTION_CAP = 3
/** 存储条目上限：只保留最近的记录，避免 storage 无界增长。 */
export const GUIDE_RECORD_LIMIT = 20

/**
 * 发布时机（S8）pending：编辑器发布成功写入，发布者落地页（我的机会列表/详情）
 * onShow 消费。带 TTL：错过落地窗口就回退到进详情的既有时机，避免陈旧弹出。
 */
export const GUIDE_PENDING_STORAGE_KEY = 'mip:opportunity-subscribe-guide:pending:v1'
export const GUIDE_PENDING_TTL_MS = 10 * 60 * 1000

export function createEmptyGuideRecord(): SubscriptionGuideRecord {
  return { shownAtByOpportunity: {}, rejectedCountByTemplate: {}, decidedTemplates: {} }
}

export function evaluateSubscriptionGuide(
  record: SubscriptionGuideRecord,
  input: SubscriptionGuidePolicyInput,
): SubscriptionGuideOutcome {
  const templateKey = input.templateKey.trim()
  const opportunityId = input.opportunityId.trim()
  if (!input.capabilityAvailable || !opportunityId) {
    return { presentation: 'HIDDEN', reason: 'TEMPLATE_MISSING' }
  }
  const decided = record.decidedTemplates[templateKey]
  if (decided === 'BANNED') {
    return { presentation: 'HIDDEN', reason: 'BANNED' }
  }
  if (decided === 'ACCEPTED') {
    return { presentation: 'HIDDEN', reason: 'ACCEPTED' }
  }
  const rejectedCount = record.rejectedCountByTemplate[templateKey] || 0
  if (rejectedCount >= Math.max(1, input.rejectionCap ?? GUIDE_REJECTION_CAP)) {
    return { presentation: 'HIDDEN', reason: 'REJECTION_CAP' }
  }
  const shownAt = record.shownAtByOpportunity[opportunityId] || 0
  if (shownAt && input.now - shownAt < Math.max(0, input.shownWithinMs ?? GUIDE_SHOWN_INTERVAL_MS)) {
    return { presentation: 'HIDDEN', reason: 'SHOWN_RECENTLY' }
  }
  if (rejectedCount > 0) {
    return { presentation: 'MANUAL', reason: 'REJECTED' }
  }
  return { presentation: 'REQUEST', reason: 'ELIGIBLE' }
}

function isFiniteCount(item: unknown): item is number {
  return typeof item === 'number' && Number.isFinite(item) && item >= 0
}

function isTerminalDecision(item: unknown): item is Exclude<SubscriptionDecision, 'REJECTED'> {
  return item === 'ACCEPTED' || item === 'BANNED'
}

function boundedEntries<T>(value: unknown, isItem: (item: unknown) => item is T): Record<string, T> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key, item]) => key.trim().length > 0 && key.length <= 80 && isItem(item))
      .slice(-GUIDE_RECORD_LIMIT),
  )
}

/** 记录一次引导层展示（REQUEST/MANUAL 形态都计），刷新该机会在限长记录中的位置。 */
export function recordGuideShown(
  record: SubscriptionGuideRecord,
  opportunityId: string,
  now: number,
): SubscriptionGuideRecord {
  const key = opportunityId.trim()
  if (!key) {
    return record
  }
  const shownAtByOpportunity = { ...record.shownAtByOpportunity }
  delete shownAtByOpportunity[key]
  shownAtByOpportunity[key] = now
  return { ...record, shownAtByOpportunity: boundedEntries(shownAtByOpportunity, isFiniteCount) }
}

/** 记录原生面板决策：REJECTED 累加并封顶；ACCEPTED / BANNED 记为终态（后者由服务端 revokeGrants 收敛）。 */
export function recordGuideDecision(
  record: SubscriptionGuideRecord,
  templateKey: string,
  decision: SubscriptionDecision,
): SubscriptionGuideRecord {
  const key = templateKey.trim()
  if (!key) {
    return record
  }
  if (decision === 'REJECTED') {
    const current = record.rejectedCountByTemplate[key] || 0
    const next = Math.min(current + 1, GUIDE_REJECTION_CAP)
    return {
      ...record,
      rejectedCountByTemplate: boundedEntries({ ...record.rejectedCountByTemplate, [key]: next }, isFiniteCount),
    }
  }
  return {
    ...record,
    decidedTemplates: boundedEntries({ ...record.decidedTemplates, [key]: decision }, isTerminalDecision),
  }
}

/** 存储回读只保留形状正确的键值；坏数据按空记录兜底（与 popup presentedIds 同口径）。 */
export function normalizeGuideRecord(value: unknown): SubscriptionGuideRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return createEmptyGuideRecord()
  }
  const source = value as Record<string, unknown>
  return {
    shownAtByOpportunity: boundedEntries(source.shownAtByOpportunity, isFiniteCount),
    rejectedCountByTemplate: boundedEntries(source.rejectedCountByTemplate, isFiniteCount),
    decidedTemplates: boundedEntries(source.decidedTemplates, isTerminalDecision),
  }
}

/** 发布成功时写入 pending（页面负责放进 storage）；非法 ID 返回空串，不产生 pending。 */
export function writePendingGuideOpportunity(opportunityId: string, now: number): string {
  const key = opportunityId.trim()
  if (!key || key.length > 64) {
    return ''
  }
  return JSON.stringify({ id: key, at: now })
}

/** 消费端读取 pending：形状/时长不合规（含时钟回拨）一律视为无 pending。 */
export function readPendingGuideOpportunity(raw: unknown, now: number): string {
  if (typeof raw !== 'string' || !raw.trim()) {
    return ''
  }
  try {
    const value = JSON.parse(raw) as unknown
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return ''
    }
    const id = (value as Record<string, unknown>).id
    const at = (value as Record<string, unknown>).at
    if (typeof id !== 'string' || !id.trim() || id.trim().length > 64) {
      return ''
    }
    if (typeof at !== 'number' || !Number.isFinite(at)
      || now - at > GUIDE_PENDING_TTL_MS || now - at < 0) {
      return ''
    }
    return id.trim()
  }
  catch {
    return ''
  }
}
