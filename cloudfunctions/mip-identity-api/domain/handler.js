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
  PROFILE_CARD_CODE_UNAVAILABLE: '个人名片码暂时不可用',
  PROFILE_CARD_OPENAPI_INVALID_RESPONSE: '个人名片码暂时不可用',
  PROFILE_CARD_OPENAPI_UNAVAILABLE: '个人名片码暂时不可用',
  PROFILE_CARD_STORAGE_INVALID_RESPONSE: '个人名片码暂时不可用',
  PROFILE_CARD_STORAGE_UNAVAILABLE: '个人名片码暂时不可用',
  PHONE_BIND_FAILED: '手机号绑定失败，请重试',
  PHONE_ALREADY_BOUND: '该手机号已绑定其他账号',
  PHONE_CODE_INVALID: '手机号授权已失效，请重新授权',
  PHONE_CODE_REQUIRED: '未获得手机号授权码',
  PHONE_ENCRYPTION_NOT_CONFIGURED: '手机号服务尚未配置',
  PHONE_PERMISSION_REQUIRED: '手机号能力尚未开通，请联系管理员',
  PHONE_SERVICE_UNAVAILABLE: '手机号服务暂时不可用',
  PROFILE_TAG_INVALID: '资料标签不存在或当前不可用',
  PROFILE_AVATAR_INVALID: '头像素材不存在或当前不可用',
  CONTACT_SERVICE_UNAVAILABLE: '联系方式服务暂时不可用',
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
  'PHONE_CODE_INVALID',
  'PHONE_SERVICE_UNAVAILABLE',
  'PROFILE_CARD_OPENAPI_INVALID_RESPONSE',
  'PROFILE_CARD_OPENAPI_UNAVAILABLE',
  'PROFILE_CARD_STORAGE_INVALID_RESPONSE',
  'PROFILE_CARD_STORAGE_UNAVAILABLE',
])

const CONTRACT_VERSION = 1

const actions = Object.freeze({
  signIn: (service, caller) => service.signIn(caller),
  acceptAgreements: (service, caller, input) => service.acceptAgreements(caller, input),
  bindWechatPhone: (service, caller, input) => service.bindWechatPhone(caller, { code: input.code }),
  closeAccount: (service, caller, input) => service.closeAccount(caller, { input }),
  getAccessSnapshot: (service, caller) => service.getAccessSnapshot(caller),
  getProfile: (service, caller) => service.getProfile(caller),
  getMyProfileCardCode: (service, caller) => service.getMyProfileCardCode(caller),
  getPublicProfile: (service, caller, input) => service.getPublicProfile(caller, {
    profileRef: input.profileRef,
  }),
  resolveProfileCardScene: (service, caller, input) => service.resolveProfileCardScene(caller, {
    scene: input.scene,
  }),
  listBranches: (service, caller) => service.listBranches(caller),
  listProfileTags: (service, caller) => service.listProfileTags(caller),
  setPrimaryBranch: (service, caller, input) => service.setPrimaryBranch(caller, { input }),
  updateProfile: (service, caller, input) => service.updateProfile(caller, { input }),
  updateCard: (service, caller, input) => service.updateCard(caller, { input }),
})

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function withoutCloudbaseMetadata(event) {
  const request = { ...event }
  for (const key of ['userInfo', 'tcbContext']) {
    if (!Object.hasOwn(request, key)) {
      continue
    }
    if (!isRecord(request[key])) {
      throw new Error('VALIDATION_FAILED')
    }
    delete request[key]
  }
  return request
}

function businessInput(value) {
  const {
    action: _action,
    contractVersion: _contractVersion,
    input: _input,
    ...input
  } = value
  return input
}

function containsRouteField(value) {
  return Object.keys(value).some(key => ['action', 'contractVersion', 'input'].includes(key))
}

function normalizeRequest(rawEvent) {
  if (!isRecord(rawEvent)) {
    throw new Error('VALIDATION_FAILED')
  }
  const event = withoutCloudbaseMetadata(rawEvent)
  const action = typeof event.action === 'string' ? event.action : ''
  if (event.contractVersion === undefined) {
    if (Object.hasOwn(event, 'input')) {
      if (!isRecord(event.input)
        || Object.keys(event).some(key => !['action', 'input'].includes(key))
        || containsRouteField(event.input)) {
        throw new Error('VALIDATION_FAILED')
      }
      return {
        action,
        input: { ...event.input },
        legacy: true,
      }
    }
    return {
      action,
      input: businessInput(event),
      legacy: true,
    }
  }
  if (event.contractVersion !== CONTRACT_VERSION
    || !isRecord(event.input)
    || Object.keys(event).some(key => !['contractVersion', 'action', 'input'].includes(key))
    || containsRouteField(event.input)) {
    throw new Error('VALIDATION_FAILED')
  }
  return { action, input: { ...event.input }, legacy: false }
}

function createHandler(options) {
  return async function main(event = {}) {
    try {
      const request = normalizeRequest(event)
      if (request.action === 'health') {
        return success({ status: 'ok' })
      }
      if (!Object.hasOwn(actions, request.action)) {
        throw new Error('UNSUPPORTED_ACTION')
      }
      const dispatch = actions[request.action]
      const caller = options.resolveCaller(options.getContext())
      return success(await dispatch(options.service, caller, request.input))
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

module.exports = {
  CONTRACT_VERSION,
  actions,
  createHandler,
  failure,
  normalizeRequest,
  success,
}
