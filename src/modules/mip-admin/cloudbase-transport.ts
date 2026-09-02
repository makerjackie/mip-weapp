import type { CaseCloudClient } from '../../platform/cloudbase/client'
import type { AdminRequest } from './request-contract'
import type { AdminTransport } from './transport'
import { COLD_START_READ_RETRY, retryTransport } from '@weapp/shared/retry'
import { runtimeConfig } from '../../config/runtime'
import { requireCloudClient } from '../../platform/cloudbase/client'
import { MipAdminError } from './error'
import { isRetryableAdminOperationAction, retryableAdminOperationActions } from './operation-contract'

interface Envelope<T> {
  ok: boolean
  data?: T
  error?: { code?: string, message?: string, retryable?: boolean, details?: unknown }
}

export const readActions = retryableAdminOperationActions

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
        }, isRetryableAdminOperationAction(request.action) ? COLD_START_READ_RETRY : { attempts: 1 })
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
