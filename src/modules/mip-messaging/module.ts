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
  let firstPageLoadedAt = 0
  let generation = 0

  return {
    peekInbox() {
      return firstPage
    },

    async listInbox(cursor?: string, options: { force?: boolean, limit?: number } = {}) {
      if (!cursor && !options.force && firstPage) {
        return firstPage
      }
      const loadGeneration = generation
      const result = await gateway.listInbox(cursor, Math.min(30, Math.max(1, options.limit || 20)))
      if (!cursor && loadGeneration === generation) {
        firstPage = result
        firstPageLoadedAt = Date.now()
      }
      return result
    },

    peekUnreadCount() {
      return firstPage?.unreadCount
    },

    async refreshUnreadCount(options: { force?: boolean, maxAgeMs?: number } = {}) {
      const maxAgeMs = Math.max(0, options.maxAgeMs ?? 30_000)
      if (!options.force && firstPage && Date.now() - firstPageLoadedAt < maxAgeMs) {
        return firstPage.unreadCount
      }
      const page = await this.listInbox(undefined, { force: true, limit: 1 })
      return page.unreadCount
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

    recordCustomerServiceInteraction() {
      return gateway.recordCustomerServiceInteraction()
    },

    invalidate() {
      generation += 1
      firstPage = undefined
      firstPageLoadedAt = 0
    },
  }
}

export type MipMessagingModule = ReturnType<typeof createMipMessagingModule>
