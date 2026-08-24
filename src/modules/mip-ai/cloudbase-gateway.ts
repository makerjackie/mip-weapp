import type { MipAiGateway } from './types'
import { COLD_START_READ_RETRY, retryTransport } from '@weapp/shared/retry'
import { runtimeConfig } from '../../config/runtime'
import { requireCloudClient } from '../platform/cloudbase'
import { MipAiError } from './types'

interface Envelope<T> {
  ok: boolean
  data?: T
  error?: { code?: string, message?: string, retryable?: boolean }
}

const readActions = new Set(['getCapability', 'listDrafts', 'getDraft'])

function unwrap<T>(value: unknown): T {
  if (!value || typeof value !== 'object' || typeof (value as Envelope<T>).ok !== 'boolean') {
    throw new MipAiError('SERVICE_UNAVAILABLE', 'AI 草稿服务返回了无效响应', true)
  }
  const envelope = value as Envelope<T>
  if (!envelope.ok) {
    throw new MipAiError(
      envelope.error?.code || 'SERVICE_UNAVAILABLE',
      envelope.error?.message || 'AI 草稿服务请求失败',
      envelope.error?.retryable === true,
    )
  }
  return envelope.data as T
}

export function createMipAiGateway(functionName = runtimeConfig.cloudbase.aiFunctionName): MipAiGateway {
  async function call<T>(action: string, data: Record<string, unknown> = {}) {
    try {
      const response = await retryTransport(async () => {
        const cloud = await requireCloudClient()
        return cloud.callFunction({ name: functionName, data: { action, ...data } })
      }, readActions.has(action) ? COLD_START_READ_RETRY : { attempts: 1 })
      return unwrap<T>(response.result)
    }
    catch (error) {
      if (error instanceof MipAiError) {
        throw error
      }
      throw new MipAiError('SERVICE_UNAVAILABLE', 'AI 草稿服务暂时不可用，请稍后重试', true)
    }
  }

  return {
    getCapability: () => call('getCapability'),
    listDrafts: (cursor, limit) => call('listDrafts', { cursor, limit }),
    getDraft: draftId => call('getDraft', { draftId }),
    createTextDraft: intent => call('createTextDraft', intent as unknown as Record<string, unknown>),
    createVoiceDraft: intent => call('createVoiceDraft', intent as unknown as Record<string, unknown>),
    createVoiceDraftUpload: intent => call('createVoiceDraftUpload', intent as unknown as Record<string, unknown>),
    updateDraft: confirmation => call('updateDraft', confirmation as unknown as Record<string, unknown>),
    deleteDraft: (draftId, expectedVersion) => call('deleteDraft', { draftId, expectedVersion }),
  }
}

export const cloudbaseMipAiGateway = createMipAiGateway()
