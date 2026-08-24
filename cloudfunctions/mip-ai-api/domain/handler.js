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
      if (event.action === 'getDraft') return success(await options.service.getDraft(caller, event))
      if (event.action === 'createTextDraft') return success(await options.service.createTextDraft(caller, event))
      if (event.action === 'createVoiceDraft') return success(await options.service.createVoiceDraft(caller, event))
      if (event.action === 'createVoiceDraftUpload') return success(await options.service.createVoiceDraftUpload(caller, event))
      if (event.action === 'continueDraft') return success(await options.service.continueDraft(caller, event))
      if (event.action === 'updateDraft') return success(await options.service.updateDraft(caller, event))
      if (event.action === 'deleteDraft') return success(await options.service.deleteDraft(caller, event))
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
      retryable: ['CONFLICT', 'AI_PROVIDER_UNAVAILABLE', 'SERVICE_UNAVAILABLE'].includes(code),
    },
  }
}

module.exports = { createHandler, failure, success }
