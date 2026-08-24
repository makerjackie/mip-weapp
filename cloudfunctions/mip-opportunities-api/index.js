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
const { createContentSafety } = require('./domain/content-safety')
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
  getCooperationCard,
  listCooperationCards,
  listMyCooperationCards,
  saveCooperationCard,
  unpublishCooperationCard,
} = require('./domain/cooperation')
const {
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

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const contentSafety = createContentSafety(cloud)

const publicActions = new Set([
  'getCatalogs',
  'listOpportunities',
  'getOpportunity',
  'listCooperationCards',
  'getCooperationCard',
  'listSuperCases',
  'getSuperCase',
])

const messages = {
  AGREEMENT_REQUIRED: '请先确认服务协议和隐私协议',
  AI_DRAFT_CONFLICT: 'AI 草稿状态已变化，请重新载入',
  AI_DRAFT_INVALID: 'AI 草稿确认信息无效',
  AI_DRAFT_NOT_FOUND: 'AI 草稿不存在或已过期',
  AUTH_REQUIRED: '登录后可继续操作',
  CONTENT_REJECTED: '内容未通过安全检查，请修改后重试',
  CONFLICT: '内容状态已经变化，请刷新后重试',
  COOPERATION_ROLE_EXISTS: '这个合作角色已经有一张合作卡',
  FORBIDDEN: '当前没有权限执行此操作',
  NOT_FOUND: '内容不存在或已经下架',
  PHONE_REQUIRED: '请先绑定手机号',
  PROFILE_REQUIRED: '请先完善个人资料',
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
    case 'listReceivedInteractions': return listReceivedInteractions(database, caller, event)
    case 'markReceivedInteractionRead': return markReceivedInteractionRead(database, caller, event)
    case 'listCooperationCards': return listCooperationCards(database, caller, event.filter)
    case 'listMyCooperationCards': return listMyCooperationCards(database, caller, event)
    case 'getCooperationCard': return getCooperationCard(database, caller, event.id)
    case 'saveCooperationCard': return saveCooperationCard(database, contentSafety, caller, event)
    case 'unpublishCooperationCard': return unpublishCooperationCard(database, caller, event)
    case 'listSuperCases': return listSuperCases(database, caller, event)
    case 'listMySuperCases': return listMySuperCases(database, caller, event)
    case 'getSuperCase': return getSuperCase(database, caller, event.id)
    case 'saveSuperCase': return saveSuperCase(database, contentSafety, caller, event)
    case 'unpublishSuperCase': return unpublishSuperCase(database, caller, event)
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
    const identity = trustedWechatIdentity(cloud.getWXContext())
    const resolvedCaller = await resolveCaller(database, identity, { required: !publicActions.has(action) })
    const caller = { ...resolvedCaller, profileRefSecret: process.env.MIP_IDENTITY_PEPPER }
    if (requiresFullAccessAction(action)) {
      await assertFullAccessReady(database, caller, configuredAgreementRequirements())
    }
    return success(await dispatch(database, caller, { ...event, action }))
  }
  catch (error) {
    return failure(error)
  }
}

exports._test = { dispatch, failure, success }
