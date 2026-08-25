import type { EventId } from '../mip'
import type {
  AdminEventFeedbackQuery,
  CheckInCredentialMode,
  EventFeedbackDraft,
  EventFeedQuery,
  HeartHistoryKind,
  MipEventsGateway,
  PublicEventParticipantQuery,
  RegistrationIntent,
  RegistrationUpdateIntent,
} from './types'

function requestKey(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function normalizeDate(value: string | undefined) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) {
    return undefined
  }
  const [year, month, day] = value!.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day
    ? value
    : undefined
}

function normalizedQuery(query: EventFeedQuery): EventFeedQuery {
  const date = normalizeDate(query.date)
  const dateFrom = normalizeDate(query.dateFrom)
  const dateTo = normalizeDate(query.dateTo)
  if (dateFrom && dateTo && dateFrom > dateTo) {
    throw new Error('开始日期不能晚于结束日期')
  }
  return {
    ...query,
    date,
    dateFrom,
    dateTo,
    query: query.query?.trim().slice(0, 50) || undefined,
    cityName: query.cityName?.trim().slice(0, 80) || undefined,
    limit: Math.min(30, Math.max(1, query.limit || 20)),
  }
}

export function createMipEventsModule(
  gateway: MipEventsGateway,
  options: { submitRefund?: (refundId: string) => Promise<unknown> } = {},
) {
  const eventCache = new Map<string, Awaited<ReturnType<MipEventsGateway['getEvent']>>>()
  const feedCache = new Map<string, Awaited<ReturnType<MipEventsGateway['listEvents']>>>()

  function feedKey(query: EventFeedQuery) {
    return JSON.stringify(normalizedQuery(query))
  }

  return {
    peekEvents(query: EventFeedQuery) {
      return feedCache.get(feedKey(query))
    },

    async listEvents(query: EventFeedQuery, options: { force?: boolean } = {}) {
      const normalized = normalizedQuery(query)
      const key = feedKey(normalized)
      if (!options.force && feedCache.has(key)) {
        return feedCache.get(key)!
      }
      const result = await gateway.listEvents(normalized)
      feedCache.set(key, result)
      return result
    },

    peekEvent(eventId: EventId) {
      return eventCache.get(String(eventId))
    },

    async getEvent(eventId: EventId, options: { force?: boolean } = {}) {
      const key = String(eventId)
      if (options.force) {
        eventCache.delete(key)
      }
      const result = await gateway.getEvent(eventId)
      eventCache.set(key, {
        ...result,
        onlineAccessAvailable: false,
        onlineUrl: undefined,
      })
      return result
    },

    listPublicParticipants(eventId: EventId, query: PublicEventParticipantQuery = {}) {
      const keyword = query.keyword?.trim().slice(0, 80) || undefined
      if (query.userKind && !['PLAYER', 'GUEST'].includes(query.userKind)) {
        throw new Error('参与人筛选参数无效')
      }
      return gateway.listPublicParticipants(eventId, {
        keyword,
        userKind: query.userKind,
        cursor: query.cursor,
        limit: Math.min(30, Math.max(1, query.limit || 24)),
      })
    },

    listEventAlbum(eventId: EventId, cursor?: string) {
      return gateway.listEventAlbum(eventId, cursor, 20)
    },

    listMyEventAlbumSubmissions(eventId: EventId) {
      return gateway.listMyEventAlbumSubmissions(eventId)
    },

    submitEventAlbumPhoto(eventId: EventId, mediaAssetId: string, caption = '') {
      const normalizedCaption = caption.trim()
      if (!/^[0-9a-f-]{36}$/i.test(mediaAssetId)) {
        throw new Error('照片素材无效')
      }
      if (normalizedCaption.length > 300) {
        throw new Error('照片说明不能超过 300 个字')
      }
      return gateway.submitEventAlbumPhoto(eventId, mediaAssetId, normalizedCaption)
    },

    withdrawEventAlbumPhoto(photoId: string, expectedVersion: number) {
      if (!/^[0-9a-f-]{36}$/i.test(photoId)
        || !Number.isInteger(expectedVersion) || expectedVersion < 1) {
        throw new Error('照片状态无效')
      }
      return gateway.withdrawEventAlbumPhoto(photoId, expectedVersion)
    },

    listMyRegistrations(cursor?: string, category?: import('./types').MyRegistrationCategory) {
      return gateway.listMyRegistrations(cursor, category)
    },

    getMyRegistration(eventId: EventId) {
      return gateway.getMyRegistration(eventId)
    },

    async register(input: RegistrationIntent) {
      const outcome = await gateway.register({
        ...input,
        idempotencyKey: input.idempotencyKey || requestKey('event-registration'),
      })
      feedCache.clear()
      eventCache.delete(String(input.eventId))
      return outcome
    },

    async updateRegistration(input: RegistrationUpdateIntent) {
      const outcome = await gateway.updateRegistration({
        ...input,
        idempotencyKey: input.idempotencyKey || requestKey('event-registration-update'),
      })
      feedCache.clear()
      eventCache.delete(String(input.eventId))
      return outcome
    },

    async cancelRegistration(eventId: EventId, expectedVersion: number) {
      if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
        throw new Error('报名状态已变化，请刷新后重试')
      }
      const outcome = await gateway.cancelRegistration(eventId, expectedVersion)
      feedCache.clear()
      eventCache.delete(String(eventId))
      if (!outcome.refundRequired || !outcome.refundId || !outcome.paymentAvailable) {
        return outcome
      }
      try {
        await options.submitRefund?.(outcome.refundId)
        return {
          ...outcome,
          refundSubmission: options.submitRefund ? 'SUBMITTED' as const : 'PENDING_RETRY' as const,
        }
      }
      catch {
        return { ...outcome, refundSubmission: 'PENDING_RETRY' as const }
      }
    },

    checkIn(resumeToken: string) {
      const normalized = resumeToken.trim()
      if (!/^[\w-]{20,2048}\.[\w-]{43}$/.test(normalized)) {
        throw new Error('签到恢复凭证无效')
      }
      return gateway.checkIn(normalized, requestKey('event-checkin'))
    },

    resolveCheckInScene(scene: string) {
      const normalized = scene.trim()
      if (!/^s1\.[\w-]{11}\.[\w-]{11}$/.test(normalized)) {
        throw new Error('活动码无效')
      }
      return gateway.resolveCheckInScene(normalized)
    },

    resolveInvitationScene(scene: string) {
      const normalized = scene.trim()
      if (!/^i1\.[\w-]{11}\.[\w-]{11}$/.test(normalized)) {
        throw new Error('活动邀请无效')
      }
      return gateway.resolveInvitationScene(normalized)
    },

    createCheckInPoster(eventId: EventId, mode: CheckInCredentialMode = 'STATIC') {
      return gateway.createCheckInPoster(eventId, mode)
    },

    createInvitationCode(eventId: EventId) {
      return gateway.createInvitationCode(eventId)
    },

    listHeartCandidates(eventId: EventId) {
      return gateway.listHeartCandidates(eventId)
    },

    listHeartHistory(kind: HeartHistoryKind, cursor?: string) {
      if (!['SENT', 'RECEIVED'].includes(kind)) {
        throw new Error('心动记录类型无效')
      }
      return gateway.listHeartHistory(kind, cursor, 20)
    },

    getHeart(eventId: EventId) {
      return gateway.getHeart(eventId)
    },

    setHeart(eventId: EventId, targetRef: string | null, expectedVersion?: number) {
      return gateway.setHeart(eventId, targetRef, expectedVersion)
    },

    getFeedback(eventId: EventId) {
      return gateway.getFeedback(eventId)
    },

    async saveFeedback(eventId: EventId, draft: EventFeedbackDraft) {
      const body = draft.body.trim()
      if (!body || body.length > 2000) {
        throw new Error('反馈内容需为 1–2000 个字')
      }
      if (draft.rating !== undefined && (!Number.isInteger(draft.rating) || draft.rating < 1 || draft.rating > 5)) {
        throw new Error('请选择 1–5 分')
      }
      return gateway.saveFeedback(eventId, { ...draft, body })
    },

    listAdminFeedback(eventId: EventId, query: AdminEventFeedbackQuery = {}) {
      if (query.rating !== undefined && ![1, 2, 3, 4, 5].includes(query.rating)) {
        throw new Error('评分筛选参数无效')
      }
      return gateway.listAdminFeedback(eventId, {
        rating: query.rating,
        cursor: query.cursor,
        limit: Math.min(30, Math.max(1, query.limit || 20)),
      })
    },

    createInvitation(eventId: EventId) {
      return gateway.createInvitation(eventId)
    },
  }
}

export type MipEventsModule = ReturnType<typeof createMipEventsModule>
