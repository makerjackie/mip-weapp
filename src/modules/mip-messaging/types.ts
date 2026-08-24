import type { Brand, UserId } from '../mip'

export type InboxMessageId = Brand<string, 'InboxMessageId'>
export type NotificationChannel
  = | 'WECHAT_SUBSCRIPTION'
    | 'WECHAT_CUSTOMER_SERVICE'
    | 'WECHAT_SERVICE_ACCOUNT'

export type InboxMessageType
  = | 'MEMBERSHIP'
    | 'EVENT'
    | 'OPPORTUNITY'
    | 'PROFILE_INTEREST'
    | 'GROWTH'
    | 'GROWTH_LEVEL_UP'
    | 'GAME'
    | 'OPERATIONS'

export interface InboxMessage {
  id: InboxMessageId
  recipientUserId: UserId
  messageType: InboxMessageType
  title: string
  body: string
  target?: { type: string, id: string, route: string }
  readAt?: string
  createdAt: string
}

export interface InboxMessageIntent {
  recipientUserId: UserId
  messageType: InboxMessageType
  title: string
  body: string
  targetType?: string
  targetId?: string
  dedupeKey: string
}

export interface InboxMessagePage {
  items: InboxMessage[]
  nextCursor?: string
  unreadCount: number
}

export interface NotificationGrant {
  channel: NotificationChannel
  templateKey: string
  status: 'AVAILABLE' | 'CONSUMED' | 'EXPIRED' | 'REVOKED'
  expiresAt?: string
}

export type SubscriptionDecision = 'ACCEPTED' | 'REJECTED' | 'BANNED'

export interface SubscriptionCapability {
  templateKey: string
  available: boolean
  reason?: 'TEMPLATE_MISSING' | 'CLIENT_UNAVAILABLE'
}

export interface SubscriptionGrantResult {
  templateKey: string
  decision: SubscriptionDecision
  grantAvailable: boolean
}

export interface CustomerServiceWindowResult {
  channel: 'WECHAT_CUSTOMER_SERVICE'
  availableUntil: string
}

export interface ExternalDeliveryDecision {
  channel: NotificationChannel
  deliver: boolean
  reason: 'READY' | 'CHANNEL_DISABLED' | 'TEMPLATE_MISSING' | 'GRANT_UNAVAILABLE'
}

export interface MipMessagingGateway {
  listInbox: (cursor?: string, limit?: number) => Promise<InboxMessagePage>
  markRead: (messageId: InboxMessageId) => Promise<{ messageId: InboxMessageId, readAt: string }>
  recordSubscriptionDecision: (
    templateKey: string,
    decision: SubscriptionDecision,
  ) => Promise<SubscriptionGrantResult>
  recordCustomerServiceInteraction: () => Promise<CustomerServiceWindowResult>
}

export interface WechatSubscriptionRequester {
  capability: (templateKey: string) => SubscriptionCapability
  request: (templateKey: string) => Promise<SubscriptionDecision>
}

export class MipMessagingError extends Error {
  readonly code: string
  readonly retryable: boolean

  constructor(code: string, message: string, retryable = false) {
    super(message)
    this.name = 'MipMessagingError'
    this.code = code
    this.retryable = retryable
  }
}
