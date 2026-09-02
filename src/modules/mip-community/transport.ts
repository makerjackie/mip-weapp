import { COLD_START_READ_RETRY, retryTransport } from '@weapp/shared/retry'
import { runtimeConfig } from '../../config/runtime'
import { requireCloudClient } from '../../platform/cloudbase/client'
import { resolveCloudFileUrls } from '../../platform/storage/cloud-media'
import { MipCommunityError } from './types'

interface Envelope<T> {
  ok: boolean
  data?: T
  error?: { code?: string, message?: string, retryable?: boolean }
}

const readActions = new Set([
  'getAnnouncement',
  'getRelationship',
  'listAnnouncements',
  'listBlocked',
  'listEventComments',
])

function unwrap<T>(value: unknown): T {
  if (!value || typeof value !== 'object' || typeof (value as Envelope<T>).ok !== 'boolean') {
    throw new MipCommunityError('SERVICE_UNAVAILABLE', '社区服务返回了无效响应', true)
  }
  const envelope = value as Envelope<T>
  if (!envelope.ok) {
    throw new MipCommunityError(
      envelope.error?.code || 'SERVICE_UNAVAILABLE',
      envelope.error?.message || '社区服务请求失败',
      envelope.error?.retryable === true,
    )
  }
  return envelope.data as T
}

export async function callCommunityApi<T>(action: string, data: Record<string, unknown> = {}) {
  try {
    const response = await retryTransport(async () => {
      const cloud = await requireCloudClient()
      return cloud.callFunction({
        name: runtimeConfig.cloudbase.communityFunctionName,
        data: { action, ...data },
      })
    }, readActions.has(action) ? COLD_START_READ_RETRY : { attempts: 1 })
    return resolveCloudFileUrls(unwrap<T>(response.result))
  }
  catch (error) {
    if (error instanceof MipCommunityError) {
      throw error
    }
    if (error instanceof Error && !/cloud|callFunction/i.test(error.message)) {
      throw error
    }
    throw new MipCommunityError('SERVICE_UNAVAILABLE', '社区服务暂时不可用，请稍后重试', true)
  }
}
