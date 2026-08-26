'use strict'

const cloud = require('wx-server-sdk')
const {
  assertFullAccessReady,
  configuredAgreementRequirements,
  requiresFullAccessAction,
  resolveCaller,
  trustedWechatIdentity,
} = require('./lib/auth')
const { mysqlDatabase } = require('./lib/mysql')
const { createOutboxWakeup } = require('./lib/outbox-wakeup')
const { authorizeInternalMatching, verifyInternalMatching } = require('./lib/internal-matching')
const { createContentSafety } = require('./domain/content-safety')
const { createMatchingProvider } = require('./domain/matching-provider')
const {
  createMatchingRequest,
  getMatchingPreferences,
  listMatchingRequests,
  listMatchingResults,
  saveMatchingFeedback,
  saveMatchingPreferences,
} = require('./domain/matching')
const {
  endOpportunity,
  getCatalogs,
  getOpportunity,
  listMine,
  listOpportunities,
  saveOpportunity,
  setProfileInterest,
  setReferral,
} = require('./domain/opportunities')
const {
  archiveCooperationCard,
  getCooperationCard,
  listCooperationCards,
  listCooperationTalents,
  listMyCooperationCards,
  saveCooperationCard,
  unpublishCooperationCard,
} = require('./domain/cooperation')
const {
  archiveSuperCase,
  getSuperCase,
  listMySuperCases,
  listSuperCases,
  saveSuperCase,
  unpublishSuperCase,
} = require('./domain/cases')
const {
  listReceivedInteractions,
  markReceivedInteractionRead,
} = require('./domain/received-interactions')
const { recordProfileVisit } = require('./domain/profile-visits')
const { getOwnProfileInfluence } = require('./domain/profile-influence')
const {
  deleteOpportunityComment,
  getOpportunityCommentSettings,
  listOpportunityComments,
  reportOpportunityComment,
  saveOpportunityComment,
  setOpportunityCommentCall,
} = require('./domain/comments')
const {
  getPublicProfileAggregate,
  listPeople,
} = require('./domain/discovery')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const contentSafety = createContentSafety(cloud)
const matchingProvider = createMatchingProvider(cloud, {
  functionName: process.env.MIP_MATCHING_PROVIDER_FUNCTION_NAME,
  timeoutMs: process.env.MIP_MATCHING_PROVIDER_TIMEOUT_MS,
})
const outboxMutationActions = new Set([
  'saveOpportunity',
  'setReferral',
  'setProfileInterest',
  'saveSuperCase',
  'saveOpportunityComment',
  'deleteOpportunityComment',
  'setOpportunityCommentCall',
  'createMatchingRequest',
])
const outboxWakeup = createOutboxWakeup({
  cloud,
  functionName: process.env.MIP_OUTBOX_FUNCTION_NAME,
  secret: process.env.MIP_OUTBOX_HMAC_SECRET,
  sourceFunctionName: 'mip-opportunities-api',
  logger: console,
})

const publicActions = new Set([
  'getCatalogs',
  'listOpportunities',
  'getOpportunity',
  'listCooperationCards',
  'listCooperationTalents',
  'getCooperationCard',
  'listSuperCases',
  'getSuperCase',
  'listPeople',
  'getPublicProfileAggregate',
])

const messages = {
  AGREEMENT_REQUIRED: '请先确认服务协议和隐私协议',
  AI_DRAFT_CONFLICT: 'AI 草稿状态已变化，请重新载入',
  AI_DRAFT_INVALID: 'AI 草稿确认信息无效',
  AI_DRAFT_NOT_FOUND: 'AI 草稿不存在或已过期',
  AUTH_REQUIRED: '登录后可继续操作',
  CONTENT_REJECTED: '内容未通过安全检查，请修改后重试',
  CALLS_DISABLED: '当前机会已关闭打 call',
  CALL_PARTICIPANT_REQUIRED: '只有当前机会参与人可以打 call',
  COMMENTS_DISABLED: '当前机会已关闭评论',
  COMMENT_EDIT_WINDOW_CLOSED: '评论已超过可编辑时间',
  CONFLICT: '内容状态已经变化，请刷新后重试',
  COOPERATION_ROLE_EXISTS: '这个合作角色已经有一张合作卡',
  FORBIDDEN: '当前没有权限执行此操作',
  MATCHING_DISABLED: '机会撮合已关闭',
  NOT_FOUND: '内容不存在或已经下架',
  PHONE_REQUIRED: '请先绑定手机号',
  PROFILE_REQUIRED: '请先完善个人资料',
  REVIEWS_DISABLED: '当前机会暂不接受项目评价',
  SELF_CALL_FORBIDDEN: '不能给自己的内容打 call',
  SELF_REPORT_FORBIDDEN: '不能举报自己的内容',
  SERVICE_UNAVAILABLE: '机会服务暂时不可用',
  VALIDATION_FAILED: '提交内容格式不正确，请检查后重试',
}

function success(data) {
  return { ok: true, data }
}

function failure(error) {
  const code = error instanceof Error && /^[A-Z][A-Z0-9_]+$/.test(error.message)
    ? error.message
    : 'SERVICE_UNAVAILABLE'
  return {
    ok: false,
    error: {
      code,
      message: messages[code] || messages.SERVICE_UNAVAILABLE,
      retryable: ['CONFLICT', 'SERVICE_UNAVAILABLE'].includes(code),
    },
  }
}

async function dispatch(database, caller, event) {
  switch (event.action) {
    case 'getCatalogs': return getCatalogs(database, caller)
    case 'listOpportunities': return listOpportunities(database, caller, event.filter)
    case 'getOpportunity': return getOpportunity(database, caller, event.id)
    case 'listMine': return listMine(database, caller, event)
    case 'saveOpportunity': return saveOpportunity(database, contentSafety, caller, event)
    case 'endOpportunity': return endOpportunity(database, caller, event)
    case 'setReferral': return setReferral(database, caller, event)
    case 'setProfileInterest': return setProfileInterest(database, caller, event)
    case 'listPeople': return listPeople(database, caller, event.filter)
    case 'getPublicProfileAggregate': return getPublicProfileAggregate(database, caller, event)
    case 'recordProfileVisit': return recordProfileVisit(database, caller, event)
    case 'getProfileInfluence': return getOwnProfileInfluence(database, caller)
    case 'listReceivedInteractions': return listReceivedInteractions(database, caller, event)
    case 'markReceivedInteractionRead': return markReceivedInteractionRead(database, caller, event)
    case 'getOpportunityCommentSettings': return getOpportunityCommentSettings(database, caller, event)
    case 'listOpportunityComments': return listOpportunityComments(database, caller, event)
    case 'saveOpportunityComment': return saveOpportunityComment(database, contentSafety, caller, event)
    case 'deleteOpportunityComment': return deleteOpportunityComment(database, caller, event)
    case 'setOpportunityCommentCall': return setOpportunityCommentCall(database, caller, event)
    case 'reportOpportunityComment': return reportOpportunityComment(database, caller, event)
    case 'getMatchingPreferences': return getMatchingPreferences(database, caller)
    case 'saveMatchingPreferences': return saveMatchingPreferences(database, caller, event)
    case 'createMatchingRequest': return createMatchingRequest(database, matchingProvider, caller, event)
    case 'listMatchingRequests': return listMatchingRequests(database, caller, event)
    case 'listMatchingResults': return listMatchingResults(database, caller, event)
    case 'saveMatchingFeedback': return saveMatchingFeedback(database, caller, event)
    case 'listCooperationCards': return listCooperationCards(database, caller, event.filter)
    case 'listCooperationTalents': return listCooperationTalents(database, caller, event.filter)
    case 'listMyCooperationCards': return listMyCooperationCards(database, caller, event)
    case 'getCooperationCard': return getCooperationCard(database, caller, event.id)
    case 'saveCooperationCard': return saveCooperationCard(database, contentSafety, caller, event)
    case 'unpublishCooperationCard': return unpublishCooperationCard(database, caller, event)
    case 'archiveCooperationCard': return archiveCooperationCard(database, caller, event)
    case 'listSuperCases': return listSuperCases(database, caller, event)
    case 'listMySuperCases': return listMySuperCases(database, caller, event)
    case 'getSuperCase': return getSuperCase(database, caller, event.id)
    case 'saveSuperCase': return saveSuperCase(database, contentSafety, caller, event)
    case 'unpublishSuperCase': return unpublishSuperCase(database, caller, event)
    case 'archiveSuperCase': return archiveSuperCase(database, caller, event)
    default: throw new Error('NOT_FOUND')
  }
}

exports.main = async (event = {}) => {
  try {
    const action = String(event.action || '')
    const database = mysqlDatabase()
    if (action === 'health') {
      await database.one('SELECT 1 AS ok')
      return success({ service: 'mip-opportunities-api', persistence: 'cloudbase-mysql' })
    }
    if (action === 'recalculateMatchingInternal') {
      const request = verifyInternalMatching(event, {
        secret: process.env.MIP_MATCHING_INTERNAL_HMAC_SECRET,
      })
      const allowedAppIds = new Set(String(process.env.MIP_ALLOWED_APP_IDS || '')
        .split(',').map(value => value.trim()).filter(Boolean))
      if (!allowedAppIds.has(request.appId)) throw new Error('AUTH_REQUIRED')
      const data = await createMatchingRequest(database, matchingProvider, {
        appId: request.appId,
        userId: request.actorUserId,
        profileRefSecret: process.env.MIP_IDENTITY_PEPPER,
        matchingReferenceSecret: process.env.MIP_MATCHING_REFERENCE_SECRET,
      }, {
        opportunityId: request.opportunityId,
        idempotencyKey: request.idempotencyKey,
      }, {
        requestedByType: 'ADMIN',
        requesterUserId: request.requesterUserId,
        expectedSourceVersion: request.sourceVersion,
        authorize: (store, source) => authorizeInternalMatching(store, request, source),
        authorizeFinal: (store, source) => authorizeInternalMatching(
          store,
          request,
          source,
          { lock: true },
        ),
      })
      await outboxWakeup.afterSuccessfulMutation({
        appId: request.appId,
        action: 'createMatchingRequest',
        mutationActions: outboxMutationActions,
      })
      return success(data)
    }
    const identity = trustedWechatIdentity(cloud.getWXContext())
    const resolvedCaller = await resolveCaller(database, identity, { required: !publicActions.has(action) })
    const caller = {
      ...resolvedCaller,
      profileRefSecret: process.env.MIP_IDENTITY_PEPPER,
      matchingReferenceSecret: process.env.MIP_MATCHING_REFERENCE_SECRET,
    }
    if (requiresFullAccessAction(action)) {
      await assertFullAccessReady(database, caller, configuredAgreementRequirements())
    }
    const data = await dispatch(database, caller, { ...event, action })
    await outboxWakeup.afterSuccessfulMutation({
      appId: caller.appId,
      action,
      mutationActions: outboxMutationActions,
    })
    return success(data)
  }
  catch (error) {
    return failure(error)
  }
}

exports._test = { dispatch, failure, outboxMutationActions, success }
