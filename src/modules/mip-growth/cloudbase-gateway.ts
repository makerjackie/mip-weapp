import type { MipGrowthGateway } from './types'
import { retryTransport } from '@weapp/shared/retry'
import { requireCloudClient } from '../platform/cloudbase'
import { resolveMipGrowthRetryOptions } from './retry-policy'
import { MipGrowthError } from './types'

interface Envelope<T> {
  ok: boolean
  data?: T
  error?: { code?: string, message?: string, retryable?: boolean }
}

export const MIP_GROWTH_FUNCTION_NAME = 'mip-growth-api'

export interface MipGrowthTransport {
  invoke: (action: string, data?: Record<string, unknown>) => Promise<unknown>
}

function unwrap<T>(value: unknown): T {
  if (!value || typeof value !== 'object' || typeof (value as Envelope<T>).ok !== 'boolean') {
    throw new MipGrowthError('SERVICE_UNAVAILABLE', '成长服务返回了无效响应', true)
  }
  const envelope = value as Envelope<T>
  if (!envelope.ok) {
    throw new MipGrowthError(
      envelope.error?.code || 'SERVICE_UNAVAILABLE',
      envelope.error?.message || '成长服务请求失败',
      envelope.error?.retryable === true,
    )
  }
  return envelope.data as T
}

function createCloudBaseTransport(functionName: string): MipGrowthTransport {
  return {
    async invoke(action, data = {}) {
      const cloud = await requireCloudClient()
      const response = await cloud.callFunction({ name: functionName, data: { action, ...data } })
      return response.result
    },
  }
}

export function createMipGrowthGateway(
  functionName = MIP_GROWTH_FUNCTION_NAME,
  transport: MipGrowthTransport = createCloudBaseTransport(functionName),
): MipGrowthGateway {
  async function call<T>(action: string, data: Record<string, unknown> = {}) {
    try {
      const result = await retryTransport(
        () => transport.invoke(action, data),
        resolveMipGrowthRetryOptions(action),
      )
      return unwrap<T>(result)
    }
    catch (error) {
      if (error instanceof MipGrowthError) {
        throw error
      }
      throw new MipGrowthError('SERVICE_UNAVAILABLE', '成长服务暂时不可用，请稍后重试', true)
    }
  }

  return {
    getSnapshot: () => call('getSnapshot'),
    listEntries: (cursor, limit) => call('listEntries', { cursor, limit }),
    listBadgeCollection: () => call('listBadgeCollection'),
    equipBadges: (badgeIds, expectedVersion) => call('equipBadges', { badgeIds, expectedVersion }),
  }
}

export const cloudbaseMipGrowthGateway = createMipGrowthGateway()
