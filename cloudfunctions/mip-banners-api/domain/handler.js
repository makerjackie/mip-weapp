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

function createHandler(options) {
  return async function handler(event = {}) {
    try {
      if (event.action === 'health') return success(await options.health())
      const action = typeof event.action === 'string' ? event.action : ''
      const publicDispatch = publicActions[action]
      if (publicDispatch) {
        return success(await publicDispatch(options.service, options.resolveAppId()))
      }
      const adminDispatch = adminActions[action]
      if (!adminDispatch) throw new Error('NOT_FOUND')
      const caller = await options.resolveCaller()
      await options.assertAdminReady(caller)
      return success(await adminDispatch(options.service, caller, event))
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

module.exports = { adminActions, createHandler, failure, publicActions, success }
