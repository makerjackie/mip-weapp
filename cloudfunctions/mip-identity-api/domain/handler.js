'use strict'

const errorMessages = {
  ACCOUNT_CLOSURE_CONFIRMATION_REQUIRED: '请输入指定短语确认注销账号',
  ACCOUNT_CLOSURE_CONFLICT: '账号状态已变化，请重新载入后再试',
  ACCOUNT_CLOSURE_PENDING_SETTLEMENT: '仍有支付或退款正在处理，请处理完成后再试',
  AGREEMENT_VERSION_CHANGED: '协议内容已更新，请重新确认',
  AI_DRAFT_CONFLICT: 'AI 草稿状态已变化，请重新载入',
  AI_DRAFT_INVALID: 'AI 草稿确认信息无效',
  AI_DRAFT_NOT_FOUND: 'AI 草稿不存在或已过期',
  AUTH_REQUIRED: '当前微信身份不可用，请重试',
  BRANCH_NOT_FOUND: '城市分会不存在或当前不可用',
  CONFLICT: '资料状态已变化，请刷新后重试',
  FORBIDDEN: '当前没有权限执行此操作',
  IDENTITY_CONFIG_REQUIRED: '身份服务尚未配置',
  IDENTITY_REBIND_FAILED: '账号迁移暂时未完成，请重试',
  IDENTITY_UNION_CONFLICT: '账号身份需要人工核验',
  PHONE_BIND_FAILED: '手机号绑定失败，请重试',
  PHONE_ALREADY_BOUND: '该手机号已绑定其他账号',
  PHONE_CODE_REQUIRED: '未获得手机号授权码',
  PHONE_ENCRYPTION_NOT_CONFIGURED: '手机号服务尚未配置',
  PHONE_SERVICE_UNAVAILABLE: '手机号服务暂时不可用',
  PROFILE_TAG_INVALID: '资料标签不存在或当前不可用',
  PROFILE_AVATAR_INVALID: '头像素材不存在或当前不可用',
  PUBLIC_PROFILE_NOT_FOUND: '公开档案不存在或当前不可见',
  UNSUPPORTED_ACTION: '不支持该操作',
  UNION_IDENTITY_CONFIG_REQUIRED: '身份迁移配置无效',
  VALIDATION_FAILED: '提交的资料格式不正确',
}

const retryableCodes = new Set([
  'ACCOUNT_CLOSURE_CONFLICT',
  'ACCOUNT_CLOSURE_PENDING_SETTLEMENT',
  'CONFLICT',
  'IDENTITY_REBIND_FAILED',
  'PHONE_BIND_FAILED',
  'PHONE_SERVICE_UNAVAILABLE',
])

function createHandler(options) {
  const handlers = {
    acceptAgreements: (caller, event) => options.service.acceptAgreements(caller, event),
    bindWechatPhone: (caller, event) => options.service.bindWechatPhone(caller, event),
    closeAccount: (caller, event) => options.service.closeAccount(caller, event),
    getAccessSnapshot: caller => options.service.getAccessSnapshot(caller),
    getProfile: caller => options.service.getProfile(caller),
    getPublicProfile: (caller, event) => options.service.getPublicProfile(caller, event),
    listBranches: caller => options.service.listBranches(caller),
    listProfileTags: caller => options.service.listProfileTags(caller),
    setPrimaryBranch: (caller, event) => options.service.setPrimaryBranch(caller, event),
    updateProfile: (caller, event) => options.service.updateProfile(caller, event),
  }

  return async function main(event = {}) {
    if (event.action === 'health') {
      return success({ status: 'ok' })
    }
    try {
      const handler = handlers[event.action]
      if (!handler) {
        throw new Error('UNSUPPORTED_ACTION')
      }
      const caller = options.resolveCaller(options.getContext())
      return success(await handler(caller, event))
    }
    catch (error) {
      return failure(error)
    }
  }
}

function success(data) {
  return { ok: true, data }
}

function failure(error) {
  const rawCode = error instanceof Error ? error.message : ''
  const code = /^[A-Z][A-Z0-9_]+$/.test(rawCode) ? rawCode : 'INTERNAL_ERROR'
  return {
    ok: false,
    error: {
      code,
      message: errorMessages[code] || '身份服务暂时不可用',
      retryable: retryableCodes.has(code),
    },
  }
}

module.exports = { createHandler, failure, success }
