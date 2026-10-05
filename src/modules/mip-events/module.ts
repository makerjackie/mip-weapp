import type { EventId } from '../mip'
import type {
  AdminEventFeedbackQuery,
  CheckInCredentialMode,
  EventDiscoveryFilters,
  EventFeedbackAnswers,
  EventFeedbackDraft,
  EventFeedQuery,
  EventInteractionSummary,
  HeartHistoryKind,
  MipEventsGateway,
  PublicEventParticipantQuery,
  RegistrationIntent,
  RegistrationUpdateIntent,
} from './types'
import { isCooperationRoleKey } from '../mip'
import { MipEventsError } from './types'

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

const stableKeyPattern = /^[\w.:-]{1,64}$/

function normalizeStableKey(value: string | undefined, label: string) {
  const normalized = value?.trim() || ''
  if (!normalized) {
    return undefined
  }
  if (!stableKeyPattern.test(normalized)) {
    throw new Error(`${label}筛选参数无效`)
  }
  return normalized
}

function normalizeTagKeys(value: string[] | undefined) {
  if (value === undefined) {
    return undefined
  }
  if (!Array.isArray(value) || value.length > 12) {
    throw new Error('活动标签筛选参数无效')
  }
  const normalized = value.map(item => normalizeStableKey(item, '活动标签'))
  if (normalized.includes(undefined)) {
    throw new Error('活动标签筛选参数无效')
  }
  return [...new Set(normalized as string[])].sort()
}

function normalizeFeedbackAnswers(value: EventFeedbackAnswers): EventFeedbackAnswers {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('活动反馈选项无效')
  }
  if (!['RECOMMEND', 'NOT_RECOMMEND'].includes(value.recommendation)) {
    throw new Error('推荐选择无效')
  }
  if (!Array.isArray(value.roleKeys)
    || value.roleKeys.length < 1
    || value.roleKeys.length > 6
    || new Set(value.roleKeys).size !== value.roleKeys.length
    || value.roleKeys.some(roleKey => !isCooperationRoleKey(roleKey))) {
    throw new Error('合作角色需选择 1–6 项且不能重复')
  }
  if (!['JOIN_NOW', 'LEARN_MORE', 'NOT_INTERESTED'].includes(value.joinIntent)) {
    throw new Error('参与意向无效')
  }
  if (!Array.isArray(value.explorationMethods)
    || value.explorationMethods.length > 2
    || new Set(value.explorationMethods).size !== value.explorationMethods.length
    || value.explorationMethods.some(method => !['ATTEND_EVENT', 'COMMUNITY_CHAT'].includes(method))) {
    throw new Error('探索方式无效或存在重复项')
  }
  if (!['MATCH_OPPORTUNITIES', 'PRIVATE'].includes(value.rosterConsent)) {
    throw new Error('名单使用范围无效')
  }
  return {
    recommendation: value.recommendation,
    roleKeys: [...value.roleKeys],
    joinIntent: value.joinIntent,
    explorationMethods: [...value.explorationMethods],
    rosterConsent: value.rosterConsent,
  }
}

function normalizedQuery(query: EventFeedQuery): EventFeedQuery {
  const date = normalizeDate(query.date)
  const dateFrom = normalizeDate(query.dateFrom)
  const dateTo = normalizeDate(query.dateTo)
  if (dateFrom && dateTo && dateFrom > dateTo) {
    throw new Error('开始日期不能晚于结束日期')
  }
  if (query.accessType !== undefined
    && !['FREE', 'MEMBER_INCLUDED', 'PAID'].includes(query.accessType)) {
    throw new Error('参与方式筛选参数无效')
  }
  if (query.sortDirection !== undefined && !['ASC', 'DESC'].includes(query.sortDirection)) {
    throw new Error('活动排序参数无效')
  }
  return {
    ...query,
    date,
    dateFrom,
    dateTo,
    query: query.query?.trim().slice(0, 50) || undefined,
    cityName: query.cityName?.trim().slice(0, 80) || undefined,
    eventTypeKey: normalizeStableKey(query.eventTypeKey, '活动类型'),
    tagKeys: normalizeTagKeys(query.tagKeys),
    accessType: query.accessType,
    sortDirection: query.sortDirection,
    limit: Math.min(30, Math.max(1, query.limit || 20)),
  }
}

export function createMipEventsModule(
  gateway: MipEventsGateway,
  options: { submitRefund?: (refundId: string) => Promise<unknown> } = {},
) {
  const eventCache = new Map<string, Awaited<ReturnType<MipEventsGateway['getEvent']>>>()
  const eventCacheLoadedAt = new Map<string, number>()
  const feedCache = new Map<string, Awaited<ReturnType<MipEventsGateway['listEvents']>>>()
  let discoveryFiltersCache: Awaited<ReturnType<NonNullable<MipEventsGateway['getDiscoveryFilters']>>> | null = null
  let discoveryFiltersLoadedAt = 0
  let discoveryFiltersFlight: Promise<EventDiscoveryFilters> | null = null
  let generation = 0

  async function runInCurrentSession<T>(work: () => Promise<T>): Promise<T> {
    const workflowGeneration = generation
    try {
      const result = await work()
      if (workflowGeneration !== generation) {
        throw new MipEventsError('SESSION_ENDED', '当前会话已结束')
      }
      return result
    }
    catch (error) {
      if (workflowGeneration !== generation) {
        throw new MipEventsError('SESSION_ENDED', '当前会话已结束')
      }
      throw error
    }
  }

  function feedKey(query: EventFeedQuery) {
    return JSON.stringify(normalizedQuery(query))
  }

  /** 报名状态类变更（报名/改单/取消/签到）统一失效详情缓存与新鲜度标记（MIW-36）。 */
  function invalidateEventCache(key: string) {
    eventCache.delete(key)
    eventCacheLoadedAt.delete(key)
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
      const loadGeneration = generation
      const result = await gateway.listEvents(normalized)
      if (loadGeneration === generation) {
        feedCache.set(key, result)
      }
      return result
    },

    peekDiscoveryFilters() {
      return discoveryFiltersCache
    },

    async getDiscoveryFilters(options: { force?: boolean } = {}) {
      if (!gateway.getDiscoveryFilters) {
        return { eventTypes: [], tags: [] }
      }
      if (!options.force && discoveryFiltersCache && Date.now() - discoveryFiltersLoadedAt < 300_000) {
        return discoveryFiltersCache
      }
      if (discoveryFiltersFlight) {
        return discoveryFiltersFlight
      }
      const loadGeneration = generation
      const flight = gateway.getDiscoveryFilters().then((result) => {
        if (loadGeneration === generation) {
          discoveryFiltersCache = result
          discoveryFiltersLoadedAt = Date.now()
        }
        return result
      })
      discoveryFiltersFlight = flight
      try {
        return await flight
      }
      finally {
        if (discoveryFiltersFlight === flight) {
          discoveryFiltersFlight = null
        }
      }
    },

    peekEvent(eventId: EventId) {
      return eventCache.get(String(eventId))
    },

    async getEvent(eventId: EventId, options: {
      force?: boolean
      progressiveMedia?: boolean
      /** MIW-36：缓存在此年龄内直接返回（详情页 onShow 回参页不再整页强刷）。 */
      maxAgeMs?: number
    } = {}) {
      const key = String(eventId)
      // force 优先于新鲜窗口：显式强刷（重试/报名/签到后）不得被窗口内的旧缓存拦截。
      if (options.force) {
        eventCache.delete(key)
        eventCacheLoadedAt.delete(key)
      }
      const cached = eventCache.get(key)
      if (cached
        && typeof options.maxAgeMs === 'number'
        && Number.isFinite(options.maxAgeMs)
        && Date.now() - (eventCacheLoadedAt.get(key) || 0) < options.maxAgeMs) {
        return cached
      }
      const loadGeneration = generation
      const result = options.progressiveMedia
        ? await gateway.getEvent(eventId, { progressiveMedia: true })
        : await gateway.getEvent(eventId)
      if (loadGeneration === generation) {
        eventCache.set(key, {
          ...result,
          onlineAccessAvailable: false,
          onlineUrl: undefined,
        })
        eventCacheLoadedAt.set(key, Date.now())
      }
      return result
    },

    /**
     * MIW-36：心动页以 getHeart/setHeart 响应里的服务端计数回填详情胶囊，返回详情页
     * 时 onShow 应用缓存即可看到最新数字，无需整页强刷。无缓存时不动作（下次真实
     * 拉取自带 summary）。
     */
    patchEventInteractionSummary(eventId: EventId, summary: EventInteractionSummary) {
      const key = String(eventId)
      const cached = eventCache.get(key)
      if (!cached) {
        return
      }
      eventCache.set(key, { ...cached, interactionSummary: summary })
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
      invalidateEventCache(String(input.eventId))
      return outcome
    },

    async updateRegistration(input: RegistrationUpdateIntent) {
      const outcome = await gateway.updateRegistration({
        ...input,
        idempotencyKey: input.idempotencyKey || requestKey('event-registration-update'),
      })
      feedCache.clear()
      invalidateEventCache(String(input.eventId))
      return outcome
    },

    async cancelRegistration(eventId: EventId, expectedVersion: number) {
      if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
        throw new Error('报名状态已变化，请刷新后重试')
      }
      const outcome = await gateway.cancelRegistration(eventId, expectedVersion)
      feedCache.clear()
      invalidateEventCache(String(eventId))
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
      return runInCurrentSession(
        () => gateway.checkIn(normalized, requestKey('event-checkin')),
      ).then((outcome) => {
        // 签到改变报名状态（MIW-36）：失效该活动详情缓存，返回详情页时 onShow
        // 因缓存缺失立刻重新拉取，保住签到态的即时感知。
        invalidateEventCache(String(outcome.eventId))
        return outcome
      })
    },

    resolveCheckInScene(scene: string) {
      const normalized = scene.trim()
      if (!/^s1\.[\w-]{11}\.[\w-]{11}$/.test(normalized)) {
        throw new Error('活动码无效')
      }
      return runInCurrentSession(() => gateway.resolveCheckInScene(normalized))
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

    createInvitationUrl(eventId: EventId, envVersion: 'develop' | 'trial' | 'release') {
      return gateway.createInvitationUrl(eventId, envVersion)
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

    markHeartHistoryRead(readThroughAt: string) {
      return gateway.markHeartHistoryRead(readThroughAt)
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
      if (draft.body !== undefined && typeof draft.body !== 'string') {
        throw new Error('反馈内容无效')
      }
      const body = draft.body?.trim()
      if ((body?.length || 0) > 300) {
        throw new Error('反馈内容最多 300 个字')
      }
      if (!Number.isInteger(draft.rating) || draft.rating < 1 || draft.rating > 5) {
        throw new Error('请选择 1–5 分')
      }
      return gateway.saveFeedback(eventId, {
        ...draft,
        body: body || undefined,
        answers: normalizeFeedbackAnswers(draft.answers),
      })
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

    invalidate() {
      generation += 1
      eventCache.clear()
      eventCacheLoadedAt.clear()
      feedCache.clear()
      discoveryFiltersCache = null
      discoveryFiltersLoadedAt = 0
      discoveryFiltersFlight = null
    },
  }
}
