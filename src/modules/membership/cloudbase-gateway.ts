import type {
  AnnouncementDetail,
  AnnouncementSummary,
  BlockedMember,
  CheckInPass,
  Checkout,
  EditableMemberProfile,
  EventAlbumPage,
  EventDetail,
  EventFeed,
  EventFeedView,
  EventParticipantsPage,
  MemberDetail,
  MemberFeedFilter,
  MemberNotification,
  MemberProfile,
  MemberReportCategory,
  MembershipGateway,
  MembershipOrder,
  MembershipOverview,
  NotificationSubscriptionResult,
  RecommendationSummary,
  RegistrationCancellationOutcome,
  RegistrationHistoryItem,
  RegistrationOutcome,
  WechatPaymentParameters,
} from './types'
import { COLD_START_READ_RETRY, retryTransport } from '@weapp/shared/retry'
import { runtimeConfig } from '../../config/runtime'
import { resolveCloudFileUrls } from '../platform/cloud-media'
import { requireCloudClient } from '../platform/cloudbase'
import {
  MembershipDtoError,
  parseCancelRegistrationResult,
  parseEventDetail,
  parseEventParticipantsPage,
  parseRegisterEventResult,
  parseRegistrationList,
} from './dto'

interface Envelope<T> {
  ok: boolean
  data?: T
  error?: { code: string, message: string }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function unwrap<T>(value: unknown): T {
  if (!isRecord(value) || typeof value.ok !== 'boolean') {
    throw new Error('会员服务返回了无效响应')
  }
  const envelope = value as unknown as Envelope<T>
  if (!envelope.ok) {
    throw new Error(envelope.error?.message || '会员服务请求失败')
  }
  return envelope.data as T
}

function paymentParameters(value: unknown): WechatPaymentParameters {
  const source = unwrap<{ payment: unknown }>(value).payment
  if (!isRecord(source)
    || typeof source.timeStamp !== 'string'
    || typeof source.nonceStr !== 'string'
    || typeof source.package !== 'string'
    || !['MD5', 'HMAC-SHA256', 'RSA'].includes(String(source.signType))
    || typeof source.paySign !== 'string') {
    throw new Error('支付服务没有返回有效的调起参数')
  }
  return source as unknown as WechatPaymentParameters
}

const retryableReadActions = new Set([
  'getOverview',
  'listMembers',
  'listEvents',
  'getOrder',
  'getMember',
  'getEvent',
  'listEventParticipants',
  'listOrders',
  'listRegistrations',
  'listConnections',
  'listAnnouncements',
  'getAnnouncement',
  'listBlockedMembers',
  'listEventAlbum',
  'issueCheckInPass',
  'listNotifications',
])

async function callMembership<T>(action: string, data: Record<string, unknown> = {}) {
  let response
  try {
    response = await retryTransport(async () => {
      const cloud = await requireCloudClient()
      return cloud.callFunction({
        name: runtimeConfig.cloudbase.membershipFunctionName,
        data: { action, ...data },
      })
    }, retryableReadActions.has(action) ? COLD_START_READ_RETRY : { attempts: 1 })
  }
  catch {
    throw new Error('会员服务暂时不可用，请稍后重试')
  }
  return resolveCloudFileUrls(unwrap<T>(response.result))
}

export const cloudbaseMembershipGateway: MembershipGateway = {
  getOverview() {
    return callMembership<MembershipOverview>('getOverview')
  },

  listMembers(filter: MemberFeedFilter) {
    return callMembership<RecommendationSummary[]>('listMembers', { filter })
  },

  listEvents(view: EventFeedView, query = '') {
    return callMembership<EventFeed>('listEvents', { view, query })
  },

  createCheckout(planId, idempotencyKey) {
    return callMembership<Checkout>('createCheckout', { planId, idempotencyKey })
  },

  async createPayment(orderId) {
    if (!runtimeConfig.cloudbase.paymentFunctionName) {
      throw new Error('尚未配置微信支付函数')
    }
    const cloud = await requireCloudClient()
    let response
    try {
      response = await cloud.callFunction({
        name: runtimeConfig.cloudbase.paymentFunctionName,
        data: { action: 'createPayment', orderId },
      })
    }
    catch {
      throw new Error('支付服务暂时不可用，请稍后重试')
    }
    return paymentParameters(response.result)
  },

  async syncPayment(orderId) {
    if (!runtimeConfig.cloudbase.paymentFunctionName) {
      throw new Error('尚未配置微信支付函数')
    }
    const cloud = await requireCloudClient()
    let response
    try {
      response = await cloud.callFunction({
        name: runtimeConfig.cloudbase.paymentFunctionName,
        data: { action: 'syncPayment', orderId },
      })
    }
    catch {
      throw new Error('支付结果确认失败，请稍后重试')
    }
    return unwrap<{ status: 'PAYMENT_CREATED' | 'PAID' }>(response.result)
  },

  async syncRefund(refundId) {
    if (!runtimeConfig.cloudbase.paymentFunctionName) {
      throw new Error('尚未配置微信支付函数')
    }
    const cloud = await requireCloudClient()
    let response
    try {
      response = await cloud.callFunction({
        name: runtimeConfig.cloudbase.paymentFunctionName,
        data: { action: 'syncRefund', refundId },
      })
    }
    catch {
      throw new Error('退款状态查询失败，请稍后重试')
    }
    return unwrap<{ status: 'REFUND_CREATED' | 'REFUNDED' | 'REFUND_FAILED' }>(response.result)
  },

  async submitRefund(refundId) {
    if (!runtimeConfig.cloudbase.paymentFunctionName) {
      throw new Error('尚未配置微信支付函数')
    }
    const cloud = await requireCloudClient()
    try {
      const response = await cloud.callFunction({
        name: runtimeConfig.cloudbase.paymentFunctionName,
        data: { action: 'submitRefund', refundId },
      })
      return unwrap<{ status: 'REFUND_CREATED' | 'REFUNDED' }>(response.result)
    }
    catch {
      throw new Error('退款提交失败，请稍后重试')
    }
  },

  getOrder(orderId) {
    return callMembership<MembershipOrder>('getOrder', { orderId })
  },

  bindPhone(code) {
    return callMembership<MemberProfile>('bindPhone', { code })
  },

  uploadAvatar(base64) {
    return callMembership<MemberProfile>('uploadAvatar', { base64 })
  },

  updateProfile(profile: EditableMemberProfile) {
    return callMembership<MemberProfile>('updateProfile', { profile })
  },

  async registerEvent(eventId, formVersion, answers, shareProfile, idempotencyKey) {
    try {
      return parseRegisterEventResult(await callMembership<RegistrationOutcome>('registerEvent', {
        eventId,
        formVersion,
        answers,
        shareProfile,
        idempotencyKey,
      }))
    }
    catch (error) {
      if (error instanceof MembershipDtoError) {
        throw new Error(error.message)
      }
      throw error
    }
  },

  async cancelRegistration(eventId, reason = '') {
    try {
      return parseCancelRegistrationResult(await callMembership<RegistrationCancellationOutcome>(
        'cancelRegistration',
        { eventId, reason },
      ))
    }
    catch (error) {
      if (error instanceof MembershipDtoError) {
        throw new Error(error.message)
      }
      throw error
    }
  },

  updateRegistration(eventId, formVersion, answers, shareProfile, expectedVersion) {
    return callMembership('updateRegistration', {
      eventId,
      formVersion,
      answers,
      shareProfile,
      expectedVersion,
    })
  },

  getMember(memberId) {
    return callMembership<MemberDetail>('getMember', { memberId })
  },

  setFollow(memberId, following) {
    return callMembership<{ memberId: string, following: boolean }>('setFollow', {
      memberId,
      following,
    })
  },

  listConnections(direction) {
    return callMembership<RecommendationSummary[]>('listConnections', { direction })
  },

  listAnnouncements() {
    return callMembership<AnnouncementSummary[]>('listAnnouncements')
  },

  getAnnouncement(announcementId) {
    return callMembership<AnnouncementDetail>('getAnnouncement', { announcementId })
  },

  setMemberBlock(memberId, blocked) {
    return callMembership<{ memberId: string, blocked: boolean }>('setMemberBlock', {
      memberId,
      blocked,
    })
  },

  listBlockedMembers() {
    return callMembership<BlockedMember[]>('listBlockedMembers')
  },

  reportMember(
    memberId,
    category: MemberReportCategory,
    description,
    idempotencyKey,
  ) {
    return callMembership<{ id: string, status: 'PENDING', idempotent: boolean }>(
      'reportMember',
      { memberId, category, description, idempotencyKey },
    )
  },

  async getEvent(eventId) {
    try {
      return parseEventDetail(await callMembership('getEvent', { eventId })) as EventDetail
    }
    catch (error) {
      if (error instanceof MembershipDtoError) {
        throw new Error(error.message)
      }
      throw error
    }
  },

  async listEventParticipants(eventId, cursor = '', role = '') {
    try {
      return parseEventParticipantsPage(await callMembership<EventParticipantsPage>(
        'listEventParticipants',
        { eventId, cursor, role },
      ))
    }
    catch (error) {
      if (error instanceof MembershipDtoError) {
        throw new Error(error.message)
      }
      throw error
    }
  },

  listEventAlbum(eventId, cursor) {
    return callMembership<EventAlbumPage>('listEventAlbum', { eventId, cursor })
  },

  uploadEventPhoto(eventId, base64, caption) {
    return callMembership<{ id: string, status: 'PENDING_REVIEW' | 'PUBLISHED' }>(
      'uploadEventPhoto',
      { eventId, base64, caption },
    )
  },

  deleteEventPhoto(photoId) {
    return callMembership<{ id: string, status: 'REMOVED' }>('deleteEventPhoto', { photoId })
  },

  issueCheckInPass(eventId) {
    return callMembership<CheckInPass>('issueCheckInPass', { eventId })
  },

  listOrders() {
    return callMembership<MembershipOrder[]>('listOrders')
  },

  async listRegistrations() {
    try {
      return parseRegistrationList(await callMembership('listRegistrations')) as RegistrationHistoryItem[]
    }
    catch (error) {
      if (error instanceof MembershipDtoError) {
        throw new Error(error.message)
      }
      throw error
    }
  },

  listNotifications() {
    return callMembership<MemberNotification[]>('listNotifications')
  },

  markNotificationsRead(input) {
    return callMembership<{ updated: number }>('markNotificationsRead', input)
  },

  recordNotificationSubscriptions(eventId, results: NotificationSubscriptionResult[]) {
    return callMembership<{ configured: number, saved: number, accepted: number }>(
      'recordNotificationSubscriptions',
      { eventId, results },
    )
  },

  requestAccountDeletion(confirmation) {
    return callMembership<{ status: 'DELETED' }>('requestAccountDeletion', { confirmation })
  },
}
