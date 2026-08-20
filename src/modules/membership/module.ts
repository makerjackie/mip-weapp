import type { QueryOptions } from '@weapp/shared/cache'
import type {
  EditableMemberProfile,
  EventFeedView,
  MemberFeedFilter,
  MemberReportCategory,
  MembershipGateway,
  MembershipOrder,
  MembershipOverview,
  PaymentAdapter,
  PaymentMode,
  PurchaseOutcome,
  RegistrationAnswers,
} from './types'
import { createQueryCache } from '@weapp/shared/cache'

function delay(milliseconds: number) {
  return new Promise(resolve => setTimeout(resolve, milliseconds))
}

function requestId() {
  return `checkout-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

export function createMembershipModule(
  gateway: MembershipGateway,
  payment: PaymentAdapter,
  options: { pollAttempts?: number, pollIntervalMs?: number, paymentMode?: PaymentMode } = {},
) {
  const pollAttempts = options.pollAttempts ?? 1
  const pollIntervalMs = options.pollIntervalMs ?? 1000
  const paymentMode = options.paymentMode ?? 'disabled'
  const cache = createQueryCache()

  function patchOverviewProfile(profile: MembershipOverview['profile']) {
    const overview = cache.peek<MembershipOverview>('overview')
    if (overview) {
      cache.prime('overview', { ...overview, profile })
    }
  }

  async function waitForOrder(orderId: string): Promise<MembershipOrder> {
    let order = await gateway.getOrder(orderId)
    for (let attempt = 0; attempt < pollAttempts; attempt += 1) {
      try {
        await gateway.syncPayment(orderId)
      }
      catch {
        // The asynchronous callback remains authoritative when active reconciliation is temporarily unavailable.
      }
      order = await gateway.getOrder(orderId)
      if (['PAID', 'FAILED', 'CLOSED', 'REFUNDED'].includes(order.status)) {
        return order
      }
      if (attempt + 1 < pollAttempts) {
        await delay(pollIntervalMs)
      }
    }
    return order
  }

  return {
    load(queryOptions?: QueryOptions): Promise<MembershipOverview> {
      return cache.query('overview', () => gateway.getOverview(), queryOptions)
    },

    peekOverview() {
      return cache.peek<MembershipOverview>('overview')
    },

    listMembers(filter: MemberFeedFilter, queryOptions?: QueryOptions) {
      return cache.query(`members:${filter}`, () => gateway.listMembers(filter), queryOptions)
    },

    peekMembers(filter: MemberFeedFilter) {
      return cache.peek<Awaited<ReturnType<MembershipGateway['listMembers']>>>(`members:${filter}`)
    },

    listEvents(
      view: EventFeedView,
      queryOrOptions: string | QueryOptions = '',
      queryOptions?: QueryOptions,
    ) {
      const normalizedQuery = typeof queryOrOptions === 'string' ? queryOrOptions.trim() : ''
      const options = typeof queryOrOptions === 'string' ? queryOptions : queryOrOptions
      return cache.query(
        `events:${view}:${normalizedQuery}`,
        () => normalizedQuery
          ? gateway.listEvents(view, normalizedQuery)
          : gateway.listEvents(view),
        options,
      )
    },

    peekEvents(view: EventFeedView, query = '') {
      return cache.peek<Awaited<ReturnType<MembershipGateway['listEvents']>>>(
        `events:${view}:${query.trim()}`,
      )
    },

    async purchase(planId: string): Promise<PurchaseOutcome> {
      if (paymentMode === 'disabled') {
        throw new Error('当前环境未开启微信支付')
      }
      const checkout = await gateway.createCheckout(planId, requestId())
      const parameters = await gateway.createPayment(checkout.orderId)
      const requestResult = await payment.request(parameters)
      if (requestResult === 'cancelled') {
        return { status: 'cancelled' }
      }
      const order = await waitForOrder(checkout.orderId)
      cache.invalidate('orders')
      cache.invalidate('overview')
      return order.status === 'PAID'
        ? { status: 'paid', order }
        : { status: 'pending', order }
    },

    async reconcilePendingPayments() {
      const orders = await gateway.listOrders()
      const pending = orders.find(order => order.status === 'PAYMENT_CREATED')
      if (!pending) {
        return null
      }
      await gateway.syncPayment(pending.id)
      const order = await gateway.getOrder(pending.id)
      cache.invalidate('orders')
      cache.invalidate('overview')
      return order
    },

    async reconcilePendingRefunds() {
      const orders = await gateway.listOrders()
      const pending = orders
        .filter(order => order.status === 'REFUND_PENDING' && order.refundId)
        .slice(0, 3)
      if (!pending.length) {
        return orders
      }
      const results = await Promise.allSettled(
        pending.map(order => gateway.syncRefund(order.refundId as string)),
      )
      if (results.some(result => result.status === 'fulfilled' && result.value.status !== 'REFUND_CREATED')) {
        cache.invalidate('orders')
        cache.invalidate('overview')
        return gateway.listOrders()
      }
      return orders
    },

    async reconcileOrder(orderId: string) {
      let order = await gateway.getOrder(orderId)
      if (order.status === 'PAYMENT_CREATED') {
        try {
          await gateway.syncPayment(orderId)
        }
        catch {
          // The payment callback can still settle the order when active reconciliation is unavailable.
        }
        order = await gateway.getOrder(orderId)
      }
      if (order.status === 'REFUND_PENDING' && order.refundId) {
        try {
          await gateway.syncRefund(order.refundId)
        }
        catch {
          // Keep the provider callback and the next foreground reconciliation authoritative.
        }
        order = await gateway.getOrder(orderId)
      }
      cache.invalidate('orders')
      cache.invalidate('overview')
      return order
    },

    async bindPhone(code: string) {
      const profile = await gateway.bindPhone(code)
      patchOverviewProfile(profile)
      cache.invalidate('events')
      return profile
    },

    async uploadAvatar(base64: string) {
      const profile = await gateway.uploadAvatar(base64)
      patchOverviewProfile(profile)
      return profile
    },

    async updateProfile(profile: EditableMemberProfile) {
      const saved = await gateway.updateProfile(profile)
      patchOverviewProfile(saved)
      cache.invalidate('members')
      return saved
    },

    async registerEvent(
      eventId: string,
      formVersion: number,
      answers: RegistrationAnswers,
      shareProfile: boolean,
    ) {
      const result = await gateway.registerEvent(
        eventId,
        formVersion,
        answers,
        shareProfile,
        requestId(),
      )
      if (result.kind === 'PAYMENT_REQUIRED') {
        if (paymentMode === 'disabled') {
          throw new Error('当前环境未开启微信支付')
        }
        const parameters = await gateway.createPayment(result.orderId)
        const requestResult = await payment.request(parameters)
        if (requestResult === 'cancelled') {
          return { kind: 'PAYMENT_CANCELLED' as const, eventId, orderId: result.orderId }
        }
        const order = await waitForOrder(result.orderId)
        cache.invalidate('orders')
        cache.invalidate('overview')
        cache.invalidate('events')
        cache.invalidate('event')
        cache.invalidate('registrations')
        return order.status === 'PAID'
          ? { kind: 'PAID' as const, eventId, orderId: result.orderId }
          : { kind: 'PAYMENT_PENDING' as const, eventId, orderId: result.orderId }
      }
      cache.invalidate('overview')
      cache.invalidate('events')
      cache.invalidate('event')
      cache.invalidate('registrations')
      return result
    },

    async cancelRegistration(eventId: string, reason = '') {
      const result = await gateway.cancelRegistration(eventId, reason)
      if (
        result.status === 'CANCELLATION_PENDING'
        && result.refundId
        && (!result.refundStatus || result.refundStatus === 'REFUND_PENDING')
      ) {
        await gateway.submitRefund(result.refundId)
      }
      cache.invalidate('overview')
      cache.invalidate('events')
      cache.invalidate('event')
      cache.invalidate('registrations')
      return result
    },

    async updateRegistration(
      eventId: string,
      formVersion: number,
      answers: RegistrationAnswers,
      shareProfile: boolean,
      expectedVersion: number,
    ) {
      const result = await gateway.updateRegistration(
        eventId,
        formVersion,
        answers,
        shareProfile,
        expectedVersion,
      )
      cache.invalidate('events')
      cache.invalidate(`event:${eventId}`)
      cache.invalidate('registrations')
      return result
    },

    async setFollow(memberId: string, following: boolean) {
      const result = await gateway.setFollow(memberId, following)
      cache.invalidate(`member:${memberId}`)
      cache.invalidate('members')
      cache.invalidate('connections')
      return result
    },

    listAnnouncements(queryOptions?: QueryOptions) {
      return cache.query('announcements', () => gateway.listAnnouncements(), queryOptions)
    },

    peekAnnouncements() {
      return cache.peek<Awaited<ReturnType<MembershipGateway['listAnnouncements']>>>('announcements')
    },

    getAnnouncement(announcementId: string, queryOptions?: QueryOptions) {
      return cache.query(
        `announcement:${announcementId}`,
        () => gateway.getAnnouncement(announcementId),
        queryOptions,
      )
    },

    peekAnnouncement(announcementId: string) {
      return cache.peek<Awaited<ReturnType<MembershipGateway['getAnnouncement']>>>(
        `announcement:${announcementId}`,
      )
    },

    async setMemberBlock(memberId: string, blocked: boolean) {
      const result = await gateway.setMemberBlock(memberId, blocked)
      cache.invalidate('members')
      cache.invalidate('connections')
      cache.invalidate('blocked-members')
      cache.invalidate('overview')
      cache.invalidate(`member:${memberId}`)
      return result
    },

    listBlockedMembers(queryOptions?: QueryOptions) {
      return cache.query('blocked-members', () => gateway.listBlockedMembers(), queryOptions)
    },

    peekBlockedMembers() {
      return cache.peek<Awaited<ReturnType<MembershipGateway['listBlockedMembers']>>>(
        'blocked-members',
      )
    },

    reportMember(
      memberId: string,
      category: MemberReportCategory,
      description: string,
    ) {
      return gateway.reportMember(memberId, category, description, requestId())
    },

    listConnections(direction: 'following' | 'followers', queryOptions?: QueryOptions) {
      return cache.query(
        `connections:${direction}`,
        () => gateway.listConnections(direction),
        queryOptions,
      )
    },

    getMember(memberId: string, queryOptions?: QueryOptions) {
      return cache.query(`member:${memberId}`, () => gateway.getMember(memberId), queryOptions)
    },

    peekMember(memberId: string) {
      return cache.peek<Awaited<ReturnType<MembershipGateway['getMember']>>>(`member:${memberId}`)
    },

    getEvent(eventId: string, queryOptions?: QueryOptions) {
      return cache.query(`event:${eventId}`, () => gateway.getEvent(eventId), queryOptions)
    },

    peekEvent(eventId: string) {
      return cache.peek<Awaited<ReturnType<MembershipGateway['getEvent']>>>(`event:${eventId}`)
    },

    listEventParticipants(
      eventId: string,
      cursor = '',
      role = '',
      queryOptions?: QueryOptions,
    ) {
      return cache.query(
        `event-participants:${eventId}:${role}:${cursor || 'first'}`,
        () => gateway.listEventParticipants(eventId, cursor, role),
        queryOptions,
      )
    },

    peekEventParticipants(eventId: string, role = '') {
      return cache.peek<Awaited<ReturnType<MembershipGateway['listEventParticipants']>>>(
        `event-participants:${eventId}:${role}:first`,
      )
    },

    listEventAlbum(eventId: string, cursor?: string) {
      return gateway.listEventAlbum(eventId, cursor)
    },

    uploadEventPhoto(eventId: string, base64: string, caption: string) {
      return gateway.uploadEventPhoto(eventId, base64, caption)
    },

    deleteEventPhoto(photoId: string) {
      return gateway.deleteEventPhoto(photoId)
    },

    issueCheckInPass(eventId: string) {
      return gateway.issueCheckInPass(eventId)
    },

    listOrders(queryOptions?: QueryOptions) {
      return cache.query('orders', () => gateway.listOrders(), queryOptions)
    },

    peekOrders() {
      return cache.peek<Awaited<ReturnType<MembershipGateway['listOrders']>>>('orders')
    },

    listRegistrations(queryOptions?: QueryOptions) {
      return cache.query('registrations', () => gateway.listRegistrations(), queryOptions)
    },

    peekRegistrations() {
      return cache.peek<Awaited<ReturnType<MembershipGateway['listRegistrations']>>>('registrations')
    },

    listNotifications(queryOptions?: QueryOptions) {
      return cache.query('notifications', () => gateway.listNotifications(), queryOptions)
    },

    peekNotifications() {
      return cache.peek<Awaited<ReturnType<MembershipGateway['listNotifications']>>>('notifications')
    },

    async markNotificationsRead(input: { all?: boolean, ids?: string[] }) {
      const result = await gateway.markNotificationsRead(input)
      cache.invalidate('notifications')
      cache.invalidate('overview')
      return result
    },

    recordNotificationSubscriptions(
      eventId: string,
      results: Parameters<MembershipGateway['recordNotificationSubscriptions']>[1],
    ) {
      return gateway.recordNotificationSubscriptions(eventId, results)
    },

    async requestAccountDeletion(confirmation: string) {
      const result = await gateway.requestAccountDeletion(confirmation)
      cache.invalidate()
      return result
    },

    /**
     * Case-local invalidation for admin/member event mutations.
     * Prefix match covers overview, events:*, event:*, and registrations.
     */
    invalidateEventCaches() {
      cache.invalidate('overview')
      cache.invalidate('events')
      cache.invalidate('event')
      cache.invalidate('registrations')
    },
  }
}
