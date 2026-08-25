import type { CaseCloudClient } from '../platform/cloudbase'
import type { AdminRequest } from './request-contract'
import type { AdminTransport } from './transport'
import { COLD_START_READ_RETRY, retryTransport } from '@weapp/shared/retry'
import { runtimeConfig } from '../../config/runtime'
import { requireCloudClient } from '../platform/cloudbase'
import { MipAdminError } from './types'

interface Envelope<T> {
  ok: boolean
  data?: T
  error?: { code?: string, message?: string, retryable?: boolean, details?: unknown }
}

export const readActions = new Set([
  'mip.admin.session',
  'mip.admin.dashboard',
  'mip.admin.branches.list',
  'mip.admin.announcements.scopes',
  'mip.admin.announcements.list',
  'mip.admin.announcements.get',
  'mip.admin.messageCampaigns.scopes',
  'mip.admin.messageCampaigns.list',
  'mip.admin.messageCampaigns.get',
  'mip.admin.messageDeliveryReviews.list',
  'mip.admin.messageDeliveryReviews.get',
  'mip.admin.messageCampaigns.recipients',
  'mip.admin.messageTemplates.list',
  'mip.admin.messageTemplates.get',
  'mip.admin.communityReports.list',
  'mip.admin.users.list',
  'mip.admin.users.get',
  'mip.admin.events.list',
  'mip.admin.events.policy.get',
  'mip.admin.events.get',
  'mip.admin.events.insights.get',
  'mip.admin.events.album.list',
  'mip.admin.events.comments.get',
  'mip.admin.events.roster',
  'mip.admin.events.rosterAll',
  'mip.admin.roles.list',
  'mip.admin.roles.candidates',
  'mip.admin.rolePolicies.list',
  'mip.admin.opportunities.list',
  'mip.admin.opportunities.get',
  'mip.admin.opportunities.options',
  'mip.admin.opportunityComments.get',
  'mip.admin.matching.get',
  'mip.admin.growth.levels',
  'mip.admin.growth.benefits',
  'mip.admin.growth.rules',
  'mip.admin.growth.entries',
  'mip.admin.badges.list',
  'mip.admin.badges.awards',
  'mip.admin.orders.list',
  'mip.admin.knowledge.list',
  'mip.admin.knowledge.get',
  'mip.admin.exceptions.list',
  'mip.admin.audit.list',
  'mip.admin.exports.status',
])

type AdminCloudClient = Pick<CaseCloudClient, 'callFunction'>

export interface CloudBaseAdminTransportOptions {
  cloudClient?: AdminCloudClient
  functionName?: string
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function unwrap<T>(value: unknown): T {
  if (!value || typeof value !== 'object' || typeof (value as Envelope<T>).ok !== 'boolean') {
    throw new MipAdminError('SERVICE_UNAVAILABLE', '运营服务返回了无效响应', true)
  }
  const envelope = value as Envelope<T>
  if (!envelope.ok) {
    throw new MipAdminError(
      envelope.error?.code || 'SERVICE_UNAVAILABLE',
      envelope.error?.message || '运营服务请求失败',
      envelope.error?.retryable === true,
      record(envelope.error?.details) ? envelope.error.details : null,
    )
  }
  return envelope.data as T
}

export function createCloudBaseAdminTransport(
  options: CloudBaseAdminTransportOptions = {},
): AdminTransport {
  const functionName = options.functionName || runtimeConfig.cloudbase.adminFunctionName
  const getCloudClient = options.cloudClient
    ? async () => options.cloudClient as AdminCloudClient
    : requireCloudClient

  return {
    async request<T>(request: AdminRequest) {
      try {
        const response = await retryTransport(async () => {
          const cloud = await getCloudClient()
          return cloud.callFunction({ name: functionName, data: request })
        }, readActions.has(request.action) ? COLD_START_READ_RETRY : { attempts: 1 })
        return unwrap<T>(response.result)
      }
      catch (error) {
        if (error instanceof MipAdminError) {
          throw error
        }
        throw new MipAdminError('SERVICE_UNAVAILABLE', '运营服务暂时不可用，请稍后重试', true)
      }
    },
  }
}

export const cloudbaseAdminTransport = createCloudBaseAdminTransport()
