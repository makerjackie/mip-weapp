import { COLD_START_READ_RETRY, retryTransport } from '@weapp/shared/retry'
import { runtimeConfig } from '../../config/runtime'
import { resolveCloudFileUrls } from '../platform/cloud-media'
import { requireCloudClient } from '../platform/cloudbase'

interface Envelope<T> {
  ok: boolean
  data?: T
  error?: { code?: string, message?: string }
}

const readActions = new Set([
  'getCatalogs',
  'listOpportunities',
  'getOpportunity',
  'listPeople',
  'getPublicProfileAggregate',
  'getProfileInfluence',
  'listMine',
  'listReceivedInteractions',
  'getOpportunityCommentSettings',
  'listOpportunityComments',
  'listCooperationCards',
  'getCooperationCard',
  'listMyCooperationCards',
  'listSuperCases',
  'getSuperCase',
  'listMySuperCases',
  'getMatchingPreferences',
  'listMatchingRequests',
  'listMatchingResults',
])

function unwrap<T>(value: unknown): T {
  if (!value || typeof value !== 'object' || typeof (value as Envelope<T>).ok !== 'boolean') {
    throw new Error('机会服务返回了无效响应')
  }
  const envelope = value as Envelope<T>
  if (!envelope.ok) {
    throw new Error(envelope.error?.message || '机会服务请求失败')
  }
  return envelope.data as T
}

export async function callOpportunityApi<T>(action: string, data: Record<string, unknown> = {}) {
  try {
    const response = await retryTransport(async () => {
      const cloud = await requireCloudClient()
      return cloud.callFunction({
        name: runtimeConfig.cloudbase.opportunitiesFunctionName,
        data: { action, ...data },
      })
    }, readActions.has(action) ? COLD_START_READ_RETRY : { attempts: 1 })
    return resolveCloudFileUrls(unwrap<T>(response.result))
  }
  catch (error) {
    if (error instanceof Error && !/cloud|callFunction/i.test(error.message)) {
      throw error
    }
    throw new Error('机会服务暂时不可用，请稍后重试')
  }
}
