import { formatLocalDate } from '../../../utils/date'

export interface MembershipBenefitPresentation {
  key: string
  label: string
  status: 'ACTIVE'
}

export interface MembershipHistoryPresentation {
  entitlementId: string
  sourceType: 'ORDER' | 'ADMIN_ADJUSTMENT'
  sourceLabel: string
  title: string
  status: 'PENDING' | 'ACTIVE' | 'SCHEDULED' | 'EXPIRED' | 'REVOKED' | 'REFUNDED'
  statusLabel: string
  startsText: string
  endsText: string
  planName: string
}

export interface MembershipBenefitsPresentation {
  membershipLabel: string
  membershipDescription: string
  membershipEndsText: string
  planEndsText: string
  currentSourceText: string
  activeBenefits: MembershipBenefitPresentation[]
  membershipHistory: MembershipHistoryPresentation[]
  isPlayer: boolean
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function sourceType(value: unknown): MembershipHistoryPresentation['sourceType'] | null {
  return value === 'ORDER' || value === 'ADMIN_ADJUSTMENT' ? value : null
}

function sourceLabel(source: MembershipHistoryPresentation['sourceType'], value: unknown): string {
  const supplied = text(value)
  if (source === 'ADMIN_ADJUSTMENT') {
    return '运营开通'
  }
  return supplied || '会员购买'
}

function status(value: unknown): MembershipHistoryPresentation['status'] | null {
  return ['PENDING', 'ACTIVE', 'SCHEDULED', 'EXPIRED', 'REVOKED', 'REFUNDED'].includes(String(value))
    ? value as MembershipHistoryPresentation['status']
    : null
}

function validOrderHistorySource(value: Record<string, unknown>): boolean {
  if (!text(value.orderId) || !record(value.plan) || !text(value.plan.id) || !text(value.plan.name)
    || !record(value.price) || value.price.currency !== 'CNY'
    || !Number.isSafeInteger(value.price.amountCents) || Number(value.price.amountCents) < 0
    || !record(value.invitationAttribution)
    || !['PLATFORM', 'USER'].includes(String(value.invitationAttribution.sourceType))
    || !text(value.invitationAttribution.displayName)) {
    return false
  }
  return true
}

function historyItem(value: unknown): MembershipHistoryPresentation | null {
  if (!record(value)) {
    return null
  }
  const itemStatus = status(value.status)
  const entitlementId = text(value.entitlementId)
  const itemSource = sourceType(value.sourceType)
  const startsText = formatLocalDate(text(value.startsAt))
  const endsText = formatLocalDate(text(value.endsAt))
  if (!itemStatus || !entitlementId || !itemSource || !startsText || !endsText) {
    return null
  }
  if (itemSource === 'ADMIN_ADJUSTMENT'
    && ['orderId', 'plan', 'price', 'invitationAttribution'].some(key => Object.hasOwn(value, key))) {
    return null
  }
  if (itemSource === 'ORDER' && !validOrderHistorySource(value)) {
    return null
  }
  const planName = itemSource === 'ORDER' && record(value.plan) ? text(value.plan.name) : ''
  const itemSourceLabel = sourceLabel(itemSource, value.sourceLabel)
  return {
    entitlementId,
    sourceType: itemSource,
    sourceLabel: itemSourceLabel,
    title: planName || itemSourceLabel,
    status: itemStatus,
    statusLabel: ({
      PENDING: '待确认',
      ACTIVE: '有效',
      SCHEDULED: '待生效',
      EXPIRED: '已到期',
      REVOKED: '已结束',
      REFUNDED: '已退款',
    })[itemStatus],
    startsText,
    endsText,
    planName,
  }
}

function benefits(value: unknown): MembershipBenefitPresentation[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value.flatMap((item) => {
    if (!record(item)) {
      return []
    }
    const key = text(item.key)
    const label = text(item.label)
    return key && label && item.status === 'ACTIVE' ? [{ key, label, status: 'ACTIVE' as const }] : []
  })
}

function guestPresentation(history: MembershipHistoryPresentation[]): MembershipBenefitsPresentation {
  return {
    membershipLabel: '嘉宾',
    membershipDescription: '当前没有有效会员权益',
    membershipEndsText: '',
    planEndsText: '',
    currentSourceText: '',
    activeBenefits: [],
    membershipHistory: history,
    isPlayer: false,
  }
}

export function presentMembershipBenefits(value: unknown): MembershipBenefitsPresentation {
  if (!record(value)) {
    return guestPresentation([])
  }
  const history = Array.isArray(value.history)
    ? value.history.flatMap(item => historyItem(item) || [])
    : []
  if (value.kind !== 'PLAYER') {
    return guestPresentation(history)
  }

  const currentSource = sourceType(value.sourceType)
  const startsText = formatLocalDate(text(value.startsAt))
  const planEndsText = formatLocalDate(text(value.endsAt))
  const membershipEndsText = formatLocalDate(text(value.membershipEndsAt))
  if (!currentSource || !startsText || !planEndsText || !membershipEndsText) {
    return guestPresentation(history)
  }
  const plan = record(value.plan) ? value.plan : null
  const planName = plan ? text(plan.name) : ''
  if (currentSource === 'ORDER' && (!plan || !text(plan.id) || !planName)) {
    return guestPresentation(history)
  }
  const currentSourceLabel = sourceLabel(currentSource, value.sourceLabel)
  return {
    membershipLabel: '玩家',
    membershipDescription: currentSource === 'ADMIN_ADJUSTMENT'
      ? currentSourceLabel
      : text(plan?.description) || planName || currentSourceLabel,
    membershipEndsText,
    planEndsText,
    currentSourceText: planName || currentSourceLabel,
    activeBenefits: benefits(value.benefits),
    membershipHistory: history,
    isPlayer: true,
  }
}
