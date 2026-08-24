'use strict'

const cloud = require('wx-server-sdk')
const { createCommunityService } = require('./domain/service')
const {
  assertInteractionReady,
  resolveActiveUser,
  trustedWechatIdentity,
} = require('./lib/identity')
const { mysqlDatabase } = require('./lib/mysql')
const { createProfileRef, readProfileRef } = require('./lib/profile-ref')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const messages = {
  ANNOUNCEMENT_NOT_FOUND: '公告不存在或当前不可见',
  AGREEMENT_REQUIRED: '请先确认服务协议和隐私协议',
  AUTH_REQUIRED: '登录后可继续操作',
  FORBIDDEN: '当前账号无法执行此操作',
  IDEMPOTENCY_CONFLICT: '本次举报请求与已提交内容不一致',
  IDENTITY_CONFIG_REQUIRED: '身份服务尚未配置',
  PHONE_REQUIRED: '请先绑定手机号',
  PROFILE_REQUIRED: '请先完善个人资料',
  COMMENT_NOT_FOUND: '评论不存在或当前不可见',
  COMMENTS_DISABLED: '当前内容已关闭评论',
  CONFLICT: '内容状态已变化，请刷新后重试',
  KNOWLEDGE_CONTENT_NOT_FOUND: '内容不存在或当前不可见',
  SELF_REPORT_FORBIDDEN: '不能举报自己的评论',
  SELF_TARGET: '不能对自己执行此操作',
  TARGET_NOT_FOUND: '用户档案不存在或当前不可用',
  UNSUPPORTED_ACTION: '不支持该操作',
  VALIDATION_FAILED: '提交内容格式不正确，请检查后重试',
}

function success(data) {
  return { ok: true, data }
}

function failure(error) {
  const rawCode = error instanceof Error ? error.message : ''
  const code = /^[A-Z][A-Z0-9_]+$/.test(rawCode) ? rawCode : 'SERVICE_UNAVAILABLE'
  return {
    ok: false,
    error: {
      code,
      message: messages[code] || '社区安全服务暂时不可用',
      retryable: code === 'SERVICE_UNAVAILABLE',
    },
  }
}

function createHandler(options) {
  return async function handler(event = {}) {
    const action = String(event.action || '')
    if (action === 'health') {
      await options.database.one('SELECT 1 AS ok')
      return success({ service: 'mip-community-api', persistence: 'cloudbase-mysql' })
    }
    try {
      const identity = options.resolveIdentity(options.getContext())
      if (action === 'listAnnouncements') {
        return success(await options.service.listAnnouncements(identity, event))
      }
      if (action === 'getAnnouncement') {
        return success(await options.service.getAnnouncement(identity, event))
      }
      if (action === 'listKnowledgeCategories') {
        return success(await options.service.listKnowledgeCategories(identity, event))
      }
      if (action === 'listKnowledgeContents') {
        return success(await options.service.listKnowledgeContents(identity, event))
      }
      if (action === 'getKnowledgeContent') {
        return success(await options.service.getKnowledgeContent(identity, event))
      }
      if (action === 'listKnowledgeComments') {
        return success(await options.service.listKnowledgeComments(identity, event))
      }
      const caller = await options.resolveUser(options.database, identity)
      await options.assertReady(options.database, caller)
      switch (action) {
        case 'getRelationship': return success(await options.service.getRelationship(caller, event))
        case 'blockProfile': return success(await options.service.blockProfile(caller, event))
        case 'unblockProfile': return success(await options.service.unblockProfile(caller, event))
        case 'listBlocked': return success(await options.service.listBlocked(caller, event))
        case 'reportProfile': return success(await options.service.reportProfile(caller, event))
        case 'createKnowledgeComment': return success(await options.service.createKnowledgeComment(caller, event))
        case 'deleteKnowledgeComment': return success(await options.service.deleteKnowledgeComment(caller, event))
        case 'reportKnowledgeComment': return success(await options.service.reportKnowledgeComment(caller, event))
        default: throw new Error('UNSUPPORTED_ACTION')
      }
    }
    catch (error) {
      return failure(error)
    }
  }
}

const database = mysqlDatabase()
const service = createCommunityService(database, {
  catalogStage: process.env.MIP_CATALOG_STAGE,
  createProfileRef,
  readProfileRef,
  profileRefSecret: process.env.MIP_IDENTITY_PEPPER,
  async assertKnowledgeSafe(identity, body) {
    const checker = cloud.openapi?.security?.msgSecCheck
    if (typeof checker !== 'function') throw new Error('SERVICE_UNAVAILABLE')
    const context = cloud.getWXContext()
    const openid = String(context.FROM_OPENID || context.OPENID || '')
    try {
      const result = await checker({ content: String(body).slice(0, 800), version: 2, scene: 2, openid })
      const errorCode = Number(result?.errCode ?? result?.errcode)
      if (errorCode !== 0 || result?.result?.suggest !== 'pass') throw new Error('VALIDATION_FAILED')
    }
    catch (error) {
      if (error?.message === 'VALIDATION_FAILED') throw error
      throw new Error('SERVICE_UNAVAILABLE')
    }
  },
})
const handler = createHandler({
  assertReady: assertInteractionReady,
  database,
  getContext: () => cloud.getWXContext(),
  resolveIdentity: trustedWechatIdentity,
  resolveUser: resolveActiveUser,
  service,
})

exports.main = handler
exports._test = { createHandler, failure, success }
