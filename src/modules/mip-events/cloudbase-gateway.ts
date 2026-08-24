import type { EventId } from '../mip'
import type {
  AdminEventFeedbackPage,
  AdminEventFeedbackQuery,
  CheckInCredentialMode,
  CheckInOutcome,
  CheckInPosterCredential,
  CheckInScene,
  EventAlbumPage,
  EventAlbumSubmission,
  EventFeedback,
  EventFeedbackDraft,
  EventFeedQuery,
  EventFeedResult,
  EventInvitationCode,
  HeartCandidate,
  HeartHistoryKind,
  HeartHistoryPage,
  HeartState,
  InvitationSceneResolution,
  MipEventDetail,
  MipEventsGateway,
  MyEventAlbumSubmissions,
  MyEventRegistration,
  PublicEventParticipantPage,
  RegistrationCancellation,
  RegistrationIntent,
  RegistrationOutcome,
  RegistrationSummary,
  RegistrationUpdateIntent,
} from './types'
import { COLD_START_READ_RETRY, retryTransport } from '@weapp/shared/retry'
import { runtimeConfig } from '../../config/runtime'
import { resolveCloudFileUrls } from '../platform/cloud-media'
import { requireCloudClient } from '../platform/cloudbase'
import { MipEventsError } from './types'

interface Envelope<T> {
  ok: boolean
  data?: T
  error?: { code?: string, message?: string, retryable?: boolean }
}

const readActions = new Set([
  'mip.events.list',
  'mip.events.detail',
  'mip.events.publicParticipants',
  'mip.events.album.list',
  'mip.events.album.mine',
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

async function callEvents<T>(action: string, data: Record<string, unknown> = {}) {
  try {
    const response = await retryTransport(async () => {
      const cloud = await requireCloudClient()
      return cloud.callFunction({
        name: runtimeConfig.cloudbase.eventsFunctionName,
        data: { action, ...data },
      })
    }, readActions.has(action) ? COLD_START_READ_RETRY : { attempts: 1 })
    return resolveCloudFileUrls(unwrap<T>(response.result))
  }
  catch (error) {
    if (error instanceof MipEventsError) {
      throw error
    }
    throw new MipEventsError('SERVICE_UNAVAILABLE', '活动服务暂时不可用，请稍后重试', true)
  }
}

export const cloudbaseMipEventsGateway: MipEventsGateway = {
  listEvents(query: EventFeedQuery) {
    return callEvents<EventFeedResult>('mip.events.list', { query })
  },

  getEvent(eventId: EventId) {
    return callEvents<MipEventDetail>('mip.events.detail', { eventId })
  },

  listPublicParticipants(eventId: EventId, query = {}) {
    return callEvents<PublicEventParticipantPage>('mip.events.publicParticipants', { eventId, query })
  },

  listEventAlbum(eventId: EventId, cursor?: string, limit = 20) {
    return callEvents<EventAlbumPage>('mip.events.album.list', { eventId, cursor, limit })
  },

  listMyEventAlbumSubmissions(eventId: EventId) {
    return callEvents<MyEventAlbumSubmissions>('mip.events.album.mine', { eventId })
  },

  submitEventAlbumPhoto(eventId: EventId, mediaAssetId: string, caption: string) {
    return callEvents<EventAlbumSubmission>('mip.events.album.submit', { eventId, mediaAssetId, caption })
  },

  withdrawEventAlbumPhoto(photoId: string, expectedVersion: number) {
    return callEvents<{ id: string, status: 'WITHDRAWN', version: number }>(
      'mip.events.album.withdraw',
      { photoId, expectedVersion },
    )
  },

  listMyRegistrations(cursor?: string) {
    return callEvents<{ items: RegistrationSummary[], nextCursor?: string }>('mip.events.mine', { cursor })
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

  cancelRegistration(eventId: EventId, expectedVersion?: number) {
    return callEvents<RegistrationCancellation>('mip.events.cancelRegistration', { eventId, expectedVersion })
  },

  checkIn(scanToken: string, idempotencyKey: string) {
    return callEvents<CheckInOutcome>('mip.events.checkIn', { scanToken, idempotencyKey })
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

  createInvitationCode(eventId: EventId) {
    return callEvents<EventInvitationCode>('mip.events.createInvitationCode', { eventId })
  },

  listHeartCandidates(eventId: EventId) {
    return callEvents<HeartCandidate[]>('mip.events.heartCandidates', { eventId })
  },

  listHeartHistory(kind: HeartHistoryKind, cursor?: string, limit = 20) {
    return callEvents<HeartHistoryPage>('mip.events.hearts.mine', { kind, cursor, limit })
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
    return callEvents<EventFeedback>('mip.events.saveFeedback', { eventId, draft })
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
    return callEvents<{ token: string }>('mip.events.createInvitation', { eventId })
  },
}
