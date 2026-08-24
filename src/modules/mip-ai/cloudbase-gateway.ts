import type {
  AiCapability,
  DigitalAvatarGeneration,
  DigitalAvatarGenerationPage,
  DigitalAvatarStyleKey,
  MipAiGateway,
} from './types'
import { COLD_START_READ_RETRY, retryTransport } from '@weapp/shared/retry'
import { runtimeConfig } from '../../config/runtime'
import { resolveCloudFileUrls } from '../platform/cloud-media'
import { requireCloudClient } from '../platform/cloudbase'
import { MipAiError } from './types'

interface Envelope<T> {
  ok: boolean
  data?: T
  error?: { code?: string, message?: string, retryable?: boolean }
}

const readActions = new Set(['getCapability', 'listDrafts', 'getDraft', 'listDigitalAvatars'])

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const styleKeys = new Set<DigitalAvatarStyleKey>(['PROFESSIONAL', 'ILLUSTRATED', 'MONOCHROME'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function capability(value: unknown): AiCapability {
  if (!isRecord(value)
    || typeof value.voiceDrafts !== 'boolean'
    || typeof value.textDrafts !== 'boolean'
    || typeof value.refinementDrafts !== 'boolean'
    || typeof value.digitalAvatars !== 'boolean'
    || (value.reason !== undefined
      && !['PROVIDER_NOT_CONFIGURED', 'STORAGE_NOT_CONFIGURED'].includes(String(value.reason)))) {
    throw new MipAiError('INVALID_RESPONSE', 'AI 服务返回了无效能力状态')
  }
  return value as unknown as AiCapability
}

function digitalAvatarGeneration(value: unknown): DigitalAvatarGeneration {
  if (!isRecord(value)
    || typeof value.id !== 'string' || !uuidPattern.test(value.id)
    || typeof value.sourceAvatarAssetId !== 'string' || !uuidPattern.test(value.sourceAvatarAssetId)
    || typeof value.styleKey !== 'string' || !styleKeys.has(value.styleKey as DigitalAvatarStyleKey)
    || !['PROCESSING', 'READY', 'FAILED'].includes(String(value.status))
    || !Number.isInteger(value.version) || Number(value.version) < 1
    || typeof value.createdAt !== 'string' || !Number.isFinite(Date.parse(value.createdAt))
    || typeof value.updatedAt !== 'string' || !Number.isFinite(Date.parse(value.updatedAt))) {
    throw new MipAiError('INVALID_RESPONSE', '数字分身服务返回了无效记录')
  }
  if (value.status === 'READY') {
    if (typeof value.outputAssetId !== 'string' || !uuidPattern.test(value.outputAssetId)
      || typeof value.outputUrl !== 'string' || !value.outputUrl.startsWith('cloud://')
      || value.failureCode !== undefined) {
      throw new MipAiError('INVALID_RESPONSE', '数字分身服务返回了无效结果')
    }
  }
  else if (value.outputAssetId !== undefined || value.outputUrl !== undefined) {
    throw new MipAiError('INVALID_RESPONSE', '数字分身服务返回了无效状态')
  }
  if (value.status === 'FAILED') {
    if (typeof value.failureCode !== 'string' || !/^[A-Z][A-Z0-9_]{2,63}$/.test(value.failureCode)) {
      throw new MipAiError('INVALID_RESPONSE', '数字分身服务返回了无效失败状态')
    }
  }
  else if (value.failureCode !== undefined) {
    throw new MipAiError('INVALID_RESPONSE', '数字分身服务返回了无效状态')
  }
  return value as unknown as DigitalAvatarGeneration
}

function digitalAvatarPage(value: unknown): DigitalAvatarGenerationPage {
  if (!isRecord(value) || !Array.isArray(value.items) || value.items.length > 20) {
    throw new MipAiError('INVALID_RESPONSE', '数字分身服务返回了无效列表')
  }
  return { items: value.items.map(digitalAvatarGeneration) }
}

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
    getCapability: async () => capability(await call('getCapability')),
    listDrafts: (cursor, limit) => call('listDrafts', { cursor, limit }),
    getDraft: draftId => call('getDraft', { draftId }),
    createTextDraft: intent => call('createTextDraft', intent as unknown as Record<string, unknown>),
    createVoiceDraft: intent => call('createVoiceDraft', intent as unknown as Record<string, unknown>),
    createVoiceDraftUpload: intent => call('createVoiceDraftUpload', intent as unknown as Record<string, unknown>),
    continueDraft: intent => call('continueDraft', intent as unknown as Record<string, unknown>),
    updateDraft: confirmation => call('updateDraft', confirmation as unknown as Record<string, unknown>),
    deleteDraft: (draftId, expectedVersion) => call('deleteDraft', { draftId, expectedVersion }),
    async listDigitalAvatars(limit) {
      const page = digitalAvatarPage(await call('listDigitalAvatars', { limit }))
      return resolveCloudFileUrls(page)
    },
    async generateDigitalAvatar(intent) {
      const generation = digitalAvatarGeneration(await call('generateDigitalAvatar', intent as unknown as Record<string, unknown>))
      return resolveCloudFileUrls(generation)
    },
  }
}

export const cloudbaseMipAiGateway = createMipAiGateway()
