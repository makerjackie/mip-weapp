import type { MipGrowthGateway } from './types'
import { COLD_START_READ_RETRY, retryTransport } from '@weapp/shared/retry'
import { requireCloudClient } from '../platform/cloudbase'
import { MipGrowthError } from './types'

interface Envelope<T> {
  ok: boolean
  data?: T
  error?: { code?: string, message?: string, retryable?: boolean }
}

export const MIP_GROWTH_FUNCTION_NAME = 'mip-growth-api'

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

export function createMipGrowthGateway(functionName = MIP_GROWTH_FUNCTION_NAME): MipGrowthGateway {
  async function call<T>(action: string, data: Record<string, unknown> = {}) {
    try {
      const response = await retryTransport(async () => {
        const cloud = await requireCloudClient()
        return cloud.callFunction({ name: functionName, data: { action, ...data } })
      }, COLD_START_READ_RETRY)
      return unwrap<T>(response.result)
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
