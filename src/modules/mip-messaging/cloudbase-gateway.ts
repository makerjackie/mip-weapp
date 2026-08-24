import type { MipMessagingGateway } from './types'
import { COLD_START_READ_RETRY, retryTransport } from '@weapp/shared/retry'
import { runtimeConfig } from '../../config/runtime'
import { requireCloudClient } from '../platform/cloudbase'
import { MipMessagingError } from './types'

interface Envelope<T> {
  ok: boolean
  data?: T
  error?: { code?: string, message?: string, retryable?: boolean }
}

const readActions = new Set(['listInbox'])

function unwrap<T>(value: unknown): T {
  if (!value || typeof value !== 'object' || typeof (value as Envelope<T>).ok !== 'boolean') {
    throw new MipMessagingError('SERVICE_UNAVAILABLE', '消息服务返回了无效响应', true)
  }
  const envelope = value as Envelope<T>
  if (!envelope.ok) {
    throw new MipMessagingError(
      envelope.error?.code || 'SERVICE_UNAVAILABLE',
      envelope.error?.message || '消息服务请求失败',
      envelope.error?.retryable === true,
    )
  }
  return envelope.data as T
}

export function createMipMessagingGateway(
  functionName = runtimeConfig.cloudbase.notificationsFunctionName,
): MipMessagingGateway {
  async function call<T>(action: string, data: Record<string, unknown> = {}) {
    try {
      const response = await retryTransport(async () => {
        const cloud = await requireCloudClient()
        return cloud.callFunction({ name: functionName, data: { action, ...data } })
      }, readActions.has(action) ? COLD_START_READ_RETRY : { attempts: 1 })
      return unwrap<T>(response.result)
    }
    catch (error) {
      if (error instanceof MipMessagingError) {
        throw error
      }
      throw new MipMessagingError('SERVICE_UNAVAILABLE', '消息服务暂时不可用，请稍后重试', true)
    }
  }

  return {
    listInbox: (cursor, limit) => call('listInbox', { cursor, limit }),
    markRead: messageId => call('markRead', { messageId }),
    recordSubscriptionDecision: (templateKey, decision) => call('recordSubscriptionDecision', {
      templateKey,
      decision,
    }),
  }
}

export const cloudbaseMipMessagingGateway = createMipMessagingGateway()
