'use strict'

const publicActions = Object.freeze({
  'mip.banners.listActive': (service, appId) => service.listActive(appId),
})

const adminActions = Object.freeze({
  'mip.banners.admin.session': (service, caller) => service.getAdminSession(caller),
  'mip.banners.admin.list': (service, caller, event) => service.listAdmin(caller, event),
  'mip.banners.admin.get': (service, caller, event) => service.getAdmin(caller, event),
  'mip.banners.admin.save': (service, caller, event) => service.save(caller, event),
  'mip.banners.admin.changeStatus': (service, caller, event) => service.changeStatus(caller, event),
  'mip.banners.admin.move': (service, caller, event) => service.move(caller, event),
  'mip.banners.admin.delete': (service, caller, event) => service.remove(caller, event),
})

const messages = Object.freeze({
  AUTH_REQUIRED: '登录后可继续操作',
  AGREEMENT_REQUIRED: '请先确认服务协议和隐私协议',
  CONFLICT: 'Banner 状态已变化，请刷新后重试',
  CONTENT_REJECTED: 'Banner 内容未通过安全检查，请修改后重试',
  FORBIDDEN: '当前账号没有 Banner 管理权限',
  IDENTITY_CONFIG_REQUIRED: '身份服务尚未配置',
  IMAGE_ASSET_INVALID: 'Banner 图片状态无效，请重新上传',
  IMAGE_DIMENSIONS_INVALID: 'Banner 图片尺寸或比例不符合要求',
  IMAGE_NOT_OWNED: '当前账号不能使用该 Banner 图片',
  NOT_FOUND: 'Banner 不存在',
  PHONE_REQUIRED: '请先绑定手机号',
  PROFILE_REQUIRED: '请先完善个人资料',
  TARGET_INVALID: 'Banner 跳转地址不受支持',
  VALIDATION_FAILED: 'Banner 内容格式不正确',
})

const CONTRACT_VERSION = 1

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function withoutCloudbaseMetadata(value) {
  const request = { ...value }
  for (const key of ['userInfo', 'tcbContext']) {
    if (!Object.hasOwn(request, key)) continue
    if (!isRecord(request[key])) throw new Error('VALIDATION_FAILED')
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

function normalizeRequest(rawEvent) {
  if (!isRecord(rawEvent)) throw new Error('VALIDATION_FAILED')
  const event = withoutCloudbaseMetadata(rawEvent)
  const action = typeof event.action === 'string' ? event.action : ''
  if (event.contractVersion === undefined) {
    return { action, input: businessInput(event), legacy: true }
  }
  if (event.contractVersion !== CONTRACT_VERSION
    || !isRecord(event.input)
    || Object.keys(event).some(key => !['contractVersion', 'action', 'input'].includes(key))) {
    throw new Error('VALIDATION_FAILED')
  }
  return { action, input: businessInput(event.input), legacy: false }
}

function createHandler(options) {
  return async function handler(event = {}) {
    try {
      const { action, input } = normalizeRequest(event)
      if (action === 'health') return success(await options.health())
      const publicDispatch = Object.hasOwn(publicActions, action) ? publicActions[action] : null
      if (publicDispatch) {
        return success(await publicDispatch(options.service, options.resolveAppId()))
      }
      const adminDispatch = Object.hasOwn(adminActions, action) ? adminActions[action] : null
      if (!adminDispatch) throw new Error('NOT_FOUND')
      const caller = await options.resolveCaller()
      await options.assertAdminReady(caller)
      return success(await adminDispatch(options.service, caller, input))
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
  const raw = error instanceof Error ? error.message : ''
  const code = /^[A-Z][A-Z0-9_]+$/.test(raw) ? raw : 'SERVICE_UNAVAILABLE'
  return {
    ok: false,
    error: {
      code,
      message: messages[code] || 'Banner 服务暂时不可用',
      retryable: ['CONFLICT', 'SERVICE_UNAVAILABLE'].includes(code),
    },
  }
}

module.exports = {
  CONTRACT_VERSION,
  adminActions,
  createHandler,
  failure,
  normalizeRequest,
  publicActions,
  success,
}
