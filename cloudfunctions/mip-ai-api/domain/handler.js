'use strict'

const messages = {
  AI_CLEANUP_INVALID: 'AI 语音清理参数无效',
  AI_AUDIO_NOT_AVAILABLE: '语音文件不可用，请重新录制',
  AI_DRAFT_CONTENT_INVALID: '草稿内容格式不正确',
  AI_DRAFT_NOT_EDITABLE: '草稿已过期或当前不可编辑',
  AI_PROVIDER_RESPONSE_INVALID: 'AI 服务返回的草稿格式不正确',
  AI_PROVIDER_UNAVAILABLE: 'AI 草稿服务尚未配置',
  AI_STORAGE_UNAVAILABLE: '语音草稿存储尚未配置',
  AI_AUDIO_INVALID: '录音文件格式不正确',
  AI_AUDIO_UPLOAD_FAILED: '录音上传失败，请重试',
  DIGITAL_AVATAR_CONTENT_REJECTED: '生成结果未通过内容安全检查',
  DIGITAL_AVATAR_GENERATION_FAILED: '数字分身生成失败，请重试',
  DIGITAL_AVATAR_GENERATION_IN_PROGRESS: '数字分身正在生成，请稍后查看',
  DIGITAL_AVATAR_IMAGE_DIMENSIONS_INVALID: '生成结果尺寸不符合要求',
  DIGITAL_AVATAR_IMAGE_INVALID: '生成结果格式不正确',
  DIGITAL_AVATAR_IMAGE_TOO_LARGE: '生成结果文件过大',
  DIGITAL_AVATAR_PROVIDER_RESPONSE_INVALID: '数字分身服务返回了无效结果',
  DIGITAL_AVATAR_PROVIDER_UNAVAILABLE: '数字分身服务暂时不可用',
  DIGITAL_AVATAR_RESULT_INVALID: '数字分身结果不可用',
  DIGITAL_AVATAR_SAFETY_UNAVAILABLE: '内容安全检查暂时不可用',
  DIGITAL_AVATAR_SOURCE_NOT_AVAILABLE: '请先设置有效的个人头像',
  DIGITAL_AVATAR_STORAGE_UNAVAILABLE: '数字分身存储尚未配置',
  DIGITAL_AVATAR_UPLOAD_FAILED: '数字分身保存失败，请重试',
  IDEMPOTENCY_CONFLICT: '本次生成请求内容已变化，请重新选择风格',
  AUTH_REQUIRED: '登录后可使用 AI 草稿',
  CONFLICT: '草稿状态已变化，请刷新后重试',
  FORBIDDEN: '当前没有权限执行此操作',
  IDENTITY_CONFIG_REQUIRED: '身份服务尚未配置',
  INTERNAL_AUTH_NOT_CONFIGURED: 'AI 内部调用尚未配置',
  NOT_FOUND: '草稿不存在或已删除',
  VALIDATION_FAILED: '提交内容格式不正确',
}

function createHandler(options) {
  return async function main(event = {}) {
    if (event.action === 'health') {
      try {
        return success(await options.health())
      }
      catch (error) {
        return failure(error)
      }
    }
    try {
      if (event.action === 'getCapability') {
        return success(options.service.getCapability())
      }
      if (event.action === 'cleanupExpiredAudio') {
        const request = options.verifyMaintenance(event)
        return success(await options.service.cleanupExpiredAudioForApp(request.appId, request))
      }
      const caller = await options.resolveCaller()
      if (event.action === 'listDrafts') return success(await options.service.listDrafts(caller, event))
      if (event.action === 'listDigitalAvatars') return success(await options.service.listDigitalAvatars(caller, event))
      if (event.action === 'getDraft') return success(await options.service.getDraft(caller, event))
      if (event.action === 'createTextDraft') return success(await options.service.createTextDraft(caller, event))
      if (event.action === 'createVoiceDraft') return success(await options.service.createVoiceDraft(caller, event))
      if (event.action === 'createVoiceDraftUpload') return success(await options.service.createVoiceDraftUpload(caller, event))
      if (event.action === 'continueDraft') return success(await options.service.continueDraft(caller, event))
      if (event.action === 'updateDraft') return success(await options.service.updateDraft(caller, event))
      if (event.action === 'deleteDraft') return success(await options.service.deleteDraft(caller, event))
      if (event.action === 'generateDigitalAvatar') return success(await options.service.generateDigitalAvatar(caller, event))
      throw new Error('NOT_FOUND')
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
      message: messages[code] || 'AI 草稿服务暂时不可用',
      retryable: [
        'CONFLICT',
        'AI_PROVIDER_UNAVAILABLE',
        'DIGITAL_AVATAR_GENERATION_FAILED',
        'DIGITAL_AVATAR_GENERATION_IN_PROGRESS',
        'DIGITAL_AVATAR_PROVIDER_UNAVAILABLE',
        'DIGITAL_AVATAR_SAFETY_UNAVAILABLE',
        'DIGITAL_AVATAR_UPLOAD_FAILED',
        'SERVICE_UNAVAILABLE',
      ].includes(code),
    },
  }
}

module.exports = { createHandler, failure, success }
