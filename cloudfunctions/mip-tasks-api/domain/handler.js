'use strict'

const actions = Object.freeze({
  listTasks: (service, caller, event) => service.listTasks(caller, event),
  getTask: (service, caller, event) => service.getTask(caller, event),
  completeTask: (service, caller, event) => service.completeTask(caller, event),
  'admin.getSession': (service, caller) => service.getAdminSession(caller),
  'admin.getTask': (service, caller, event) => service.getAdminTask(caller, event),
  'admin.listTasks': (service, caller, event) => service.listAdminTasks(caller, event),
  'admin.listEligibleLevels': (service, caller) => service.listEligibleLevels(caller),
  'admin.listAssignableMembers': (service, caller, event) => service.listAssignableMembers(caller, event),
  'admin.assignMembers': (service, caller, event) => service.assignMembers(caller, event),
  'admin.revokeMembers': (service, caller, event) => service.revokeMembers(caller, event),
  'admin.saveTask': (service, caller, event) => service.saveTask(caller, event),
  'admin.publishTask': (service, caller, event) => service.transitionTask(caller, event, 'PUBLISHED'),
  'admin.unpublishTask': (service, caller, event) => service.transitionTask(caller, event, 'UNPUBLISHED'),
  'admin.deleteTask': (service, caller, event) => service.transitionTask(caller, event, 'DELETED'),
  'admin.listCompletions': (service, caller, event) => service.listCompletions(caller, event),
  'admin.getCompletion': (service, caller, event) => service.getCompletion(caller, event),
  'admin.exportCompletions': (service, caller, event) => service.exportCompletions(caller, event),
})

const messages = Object.freeze({
  ATTACHMENT_INVALID: '任务附件状态无效，请重新上传',
  ATTACHMENT_REQUIRED: '请先上传任务附件',
  ASSIGNMENT_MODE_REQUIRED: '请先将任务范围设置为指定成员',
  AGREEMENT_REQUIRED: '请先确认服务协议和隐私协议',
  AUTH_REQUIRED: '登录后可继续操作',
  CONFLICT: '任务状态已变化，请刷新后重试',
  CONTENT_REJECTED: '内容未通过安全检查，请修改后重试',
  EXPORT_TOO_LARGE: '符合条件的流水过多，请缩小筛选范围',
  ELIGIBLE_LEVEL_NOT_FOUND: '部分成长等级当前不可用，请刷新后重试',
  FORBIDDEN: '当前没有权限执行此操作',
  IDENTITY_CONFIG_REQUIRED: '身份服务尚未配置',
  INVALID_STATE: '当前任务状态不支持此操作',
  MEMBER_NOT_FOUND: '部分成员当前不可用，请刷新后重试',
  NOT_FOUND: '任务不存在或已经下架',
  PHONE_REQUIRED: '请先绑定手机号',
  PROFILE_REQUIRED: '请先完善个人资料',
  TASK_ENDED: '任务已截止',
  TASK_LEVEL_NOT_ELIGIBLE: '当前等级不能完成此任务',
  TEMPLATE_INVALID: '任务模板状态无效，请重新上传',
  VALIDATION_FAILED: '提交内容格式不正确，请检查后重试',
})

const CONTRACT_VERSION = 1

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
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

function normalizeRequest(event) {
  if (!isRecord(event)) throw new Error('VALIDATION_FAILED')
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
      const dispatch = Object.hasOwn(actions, action) ? actions[action] : null
      if (!dispatch) throw new Error('NOT_FOUND')
      const caller = await options.resolveCaller()
      if (action.startsWith('admin.')) await options.assertAdminReady(caller)
      return success(await dispatch(options.service, caller, input))
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
      message: messages[code] || '任务服务暂时不可用',
      retryable: ['CONFLICT', 'SERVICE_UNAVAILABLE'].includes(code),
    },
  }
}

module.exports = { CONTRACT_VERSION, actions, createHandler, failure, normalizeRequest, success }
