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
  let firstPageLimit = 0
  const unreadIds = new Set<InboxMessageId>()

  async function listInbox(cursor?: string, options: { force?: boolean, limit?: number } = {}) {
    const limit = Math.min(30, Math.max(1, options.limit || 20))
    if (!cursor && !options.force && firstPage && (firstPageLimit >= limit || !firstPage.nextCursor)) {
      return firstPage
    }
    const loadGeneration = generation
    const result = await gateway.listInbox(cursor, limit)
    if (loadGeneration === generation) {
      for (const item of result.items) {
        if (item.readAt) {
          unreadIds.delete(item.id)
        }
        else {
          unreadIds.add(item.id)
        }
      }
    }
    if (cursor && firstPage && loadGeneration === generation) {
      firstPage = { ...firstPage, unreadCount: result.unreadCount }
    }
    if (!cursor && loadGeneration === generation) {
      firstPageLimit = limit
      firstPage = result
      firstPageLoadedAt = Date.now()
    }
    return result
  }

  return {
    peekInbox() {
      return firstPage
    },

    listInbox,

    peekUnreadCount() {
      return firstPage?.unreadCount
    },

    async refreshUnreadCount(options: { force?: boolean, maxAgeMs?: number } = {}) {
      const maxAgeMs = Math.max(0, options.maxAgeMs ?? 30_000)
      if (!options.force && firstPage && Date.now() - firstPageLoadedAt < maxAgeMs) {
        return firstPage.unreadCount
      }
      const page = await listInbox(undefined, { force: true, limit: 20 })
      return firstPage?.unreadCount ?? page.unreadCount
    },

    async markRead(messageId: InboxMessageId) {
      const loadGeneration = generation
      const result = await gateway.markRead(messageId)
      if (loadGeneration !== generation) {
        return result
      }
      generation += 1
      if (firstPage) {
        firstPage = {
          ...firstPage,
          unreadCount: Math.max(0, firstPage.unreadCount - (unreadIds.has(messageId) ? 1 : 0)),
          items: firstPage.items.map(item => item.id === messageId ? { ...item, readAt: result.readAt } : item),
        }
      }
      unreadIds.delete(messageId)
      firstPageLoadedAt = 0
      return result
    },

    async markAllRead() {
      const loadGeneration = generation
      const result = await gateway.markAllRead()
      if (loadGeneration !== generation) {
        return result
      }
      generation += 1
      unreadIds.clear()
      if (firstPage) {
        firstPage = {
          ...firstPage,
          unreadCount: 0,
          items: firstPage.items.map(item => ({ ...item, readAt: item.readAt || result.readAt })),
        }
      }
      firstPageLoadedAt = 0
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
      unreadIds.clear()
    },
  }
}

export type MipMessagingModule = ReturnType<typeof createMipMessagingModule>
