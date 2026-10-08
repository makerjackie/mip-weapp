import type { EventId } from '../mip'
import type {
  AdminEventFeedbackPage,
  AdminEventFeedbackQuery,
  CheckInCredentialMode,
  CheckInOutcome,
  CheckInPosterCredential,
  CheckInScene,
  EventCalendarDates,
  EventCalendarDatesQuery,
  EventDiscoveryFilters,
  EventFeedback,
  EventFeedbackDraft,
  EventFeedQuery,
  EventFeedResult,
  EventInvitationCode,
  EventRecapList,
  HeartCandidate,
  HeartHistoryKind,
  HeartHistoryPage,
  HeartState,
  InvitationSceneResolution,
  MipEventDetail,
  MipEventsGateway,
  MyEventRegistration,
  MyRegistrationCategory,
  MyRegistrationPage,
  PublicEventParticipantPage,
  RegistrationCancellation,
  RegistrationIntent,
  RegistrationOutcome,
  RegistrationUpdateIntent,
} from './types'
import { COLD_START_READ_RETRY, retryTransport } from '@weapp/shared/retry'
import { runtimeConfig } from '../../config/runtime'
import { requireCloudClient } from '../../platform/cloudbase/client'
import { measureLoading } from '../../platform/cloudbase/loading-diagnostics'
import { resolveCloudFileUrls } from '../../platform/storage/cloud-media'
import { parseEventCalendarDates, parseEventDiscoveryFilters, parseEventFeedResult, parseEventRecapList, parseMipEventDetail } from './dto'
import { MipEventsError } from './types'

interface Envelope<T> {
  ok: boolean
  data?: T
  error?: { code?: string, message?: string, retryable?: boolean }
}

const readActions = new Set([
  'mip.events.list',
  'mip.events.calendarDates',
  'mip.events.discoveryFilters',
  'mip.events.recaps',
  'mip.events.detail',
  'mip.events.publicParticipants',
  'mip.events.mine',
  'mip.events.myRegistration',
  'mip.events.heartCandidates',
  'mip.events.hearts.mine',
  'mip.events.heart',
  'mip.events.feedback',
  'mip.events.admin.listFeedback',
  'mip.events.resolveCheckInScene',
  'mip.events.resolveInvitationScene',
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function unwrap<T>(value: unknown): T {
  if (!isRecord(value) || typeof value.ok !== 'boolean') {
    throw new MipEventsError('SERVICE_UNAVAILABLE', '活动服务返回了无效响应', true)
  }
  const envelope = value as unknown as Envelope<T>
  if (!envelope.ok) {
    throw new MipEventsError(
      envelope.error?.code || 'SERVICE_UNAVAILABLE',
      envelope.error?.message || '活动服务请求失败',
      envelope.error?.retryable === true,
    )
  }
  return envelope.data as T
}

async function callEvents<T>(action: string, data: Record<string, unknown> = {}, progressiveMedia = false) {
  try {
    const response = await measureLoading('events.request', () => retryTransport(async () => {
      const cloud = await requireCloudClient()
      return cloud.callFunction({
        name: runtimeConfig.cloudbase.eventsFunctionName,
        data: { action, ...data },
      })
    }, readActions.has(action) ? COLD_START_READ_RETRY : { attempts: 1 }))
    const result = unwrap<T>(response.result)
    // Feed cards and configured recap cards localize images after displaying business data.
    return action === 'mip.events.list' || action === 'mip.events.recaps' || progressiveMedia
      ? result
      : resolveCloudFileUrls(result)
  }
  catch (error) {
    if (error instanceof MipEventsError) {
      throw error
    }
    throw new MipEventsError('SERVICE_UNAVAILABLE', '活动服务暂时不可用，请稍后重试', true)
  }
}

export const cloudbaseMipEventsGateway: MipEventsGateway = {
  async listEvents(query: EventFeedQuery) {
    return parseEventFeedResult(await callEvents<EventFeedResult>('mip.events.list', { query }))
  },

  async getDiscoveryFilters() {
    return parseEventDiscoveryFilters(
      await callEvents<EventDiscoveryFilters>('mip.events.discoveryFilters'),
    )
  },

  async getCalendarDates(query: EventCalendarDatesQuery) {
    return parseEventCalendarDates(
      await callEvents<EventCalendarDates>('mip.events.calendarDates', { query }),
    )
  },

  async listEventRecaps() {
    // 封面交给卡片组件按云文件 ID 自行解析，与活动 feed 同一条渐进加载路径。
    return parseEventRecapList(await callEvents<EventRecapList>('mip.events.recaps'))
  },

  async getEvent(eventId: EventId, options = {}) {
    return parseMipEventDetail(await callEvents<MipEventDetail>('mip.events.detail', { eventId }, options.progressiveMedia))
  },

  listPublicParticipants(eventId: EventId, query = {}) {
    return callEvents<PublicEventParticipantPage>('mip.events.publicParticipants', { eventId, query })
  },

  listMyRegistrations(cursor?: string, category?: MyRegistrationCategory) {
    return callEvents<MyRegistrationPage>('mip.events.mine', { cursor, category })
  },

  getMyRegistration(eventId: EventId) {
    return callEvents<MyEventRegistration | null>('mip.events.myRegistration', { eventId })
  },

  register(input: RegistrationIntent) {
    return callEvents<RegistrationOutcome>('mip.events.register', input as unknown as Record<string, unknown>)
  },

  updateRegistration(input: RegistrationUpdateIntent) {
    return callEvents<MyEventRegistration>('mip.events.updateRegistration', input as unknown as Record<string, unknown>)
  },

  cancelRegistration(eventId: EventId, expectedVersion: number) {
    return callEvents<RegistrationCancellation>('mip.events.cancelRegistration', { eventId, expectedVersion })
  },

  checkIn(resumeToken: string, idempotencyKey: string) {
    return callEvents<CheckInOutcome>('mip.events.checkIn', { resumeToken, idempotencyKey })
  },

  resolveCheckInScene(scene: string) {
    return callEvents<CheckInScene>('mip.events.resolveCheckInScene', { scene })
  },

  resolveInvitationScene(scene: string) {
    return callEvents<InvitationSceneResolution>('mip.events.resolveInvitationScene', { scene })
  },

  createCheckInPoster(eventId: EventId, mode: CheckInCredentialMode = 'STATIC') {
    return callEvents<CheckInPosterCredential>('mip.events.admin.createCheckInPoster', { eventId, mode })
  },

  createInvitationUrl(eventId: EventId, envVersion: 'develop' | 'trial' | 'release') {
    return callEvents<{ url: string, inviteRef: string, validUntil: string }>('mip.events.createInvitationUrl', { eventId, envVersion })
  },

  createInvitationCode(eventId: EventId) {
    return callEvents<EventInvitationCode>('mip.events.createInvitationCode', { eventId })
  },

  listHeartCandidates(eventId: EventId) {
    return callEvents<HeartCandidate[]>('mip.events.heartCandidates', { eventId })
  },

  listHeartHistory(kind: HeartHistoryKind, cursor?: string, limit = 20) {
    return callEvents<HeartHistoryPage>('mip.events.hearts.mine', { kind, cursor, limit })
  },

  markHeartHistoryRead(readThroughAt: string) {
    return callEvents<{ readAt: string }>('mip.events.hearts.markRead', { readThroughAt })
  },

  getHeart(eventId: EventId) {
    return callEvents<HeartState>('mip.events.heart', { eventId })
  },

  setHeart(eventId: EventId, targetRef: string | null, expectedVersion?: number) {
    return callEvents<HeartState>('mip.events.setHeart', { eventId, targetRef, expectedVersion })
  },

  getFeedback(eventId: EventId) {
    return callEvents<EventFeedback | null>('mip.events.feedback', { eventId })
  },

  saveFeedback(eventId: EventId, draft: EventFeedbackDraft) {
    const { expectedVersion, ...feedback } = draft
    return callEvents<EventFeedback>('mip.events.saveFeedback', {
      eventId,
      expectedVersion,
      draft: feedback,
    })
  },

  listAdminFeedback(eventId: EventId, query: AdminEventFeedbackQuery = {}) {
    return callEvents<AdminEventFeedbackPage>('mip.events.admin.listFeedback', {
      eventId,
      cursor: query.cursor,
      limit: query.limit,
      rating: query.rating,
    })
  },

  createInvitation(eventId: EventId) {
    return callEvents<{ inviteRef: string, validUntil?: string }>('mip.events.createInvitation', { eventId })
  },
}
