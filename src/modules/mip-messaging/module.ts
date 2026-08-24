import type {
  InboxMessageId,
  MipMessagingGateway,
  WechatSubscriptionRequester,
} from './types'

export function createMipMessagingModule(
  gateway: MipMessagingGateway,
  subscriptionRequester: WechatSubscriptionRequester,
) {
  let firstPage: Awaited<ReturnType<MipMessagingGateway['listInbox']>> | undefined

  return {
    peekInbox() {
      return firstPage
    },

    async listInbox(cursor?: string, options: { force?: boolean, limit?: number } = {}) {
      if (!cursor && !options.force && firstPage) {
        return firstPage
      }
      const result = await gateway.listInbox(cursor, Math.min(30, Math.max(1, options.limit || 20)))
      if (!cursor) {
        firstPage = result
      }
      return result
    },

    async markRead(messageId: InboxMessageId) {
      const result = await gateway.markRead(messageId)
      if (firstPage) {
        firstPage = {
          ...firstPage,
          unreadCount: Math.max(0, firstPage.unreadCount - (firstPage.items.some(item => item.id === messageId && !item.readAt) ? 1 : 0)),
          items: firstPage.items.map(item => item.id === messageId ? { ...item, readAt: result.readAt } : item),
        }
      }
      return result
    },

    subscriptionCapability(templateKey: string) {
      return subscriptionRequester.capability(templateKey)
    },

    async requestWechatSubscription(templateKey: string) {
      const decision = await subscriptionRequester.request(templateKey)
      return gateway.recordSubscriptionDecision(templateKey, decision)
    },

    invalidate() {
      firstPage = undefined
    },
  }
}

export type MipMessagingModule = ReturnType<typeof createMipMessagingModule>
