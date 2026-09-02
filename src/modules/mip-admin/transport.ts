import type { AdminRequest, AdminRequestInput } from './request-contract'
import { MipAdminError } from './error'

export interface AdminTransport {
  request: <T>(request: AdminRequest) => Promise<T>
}

export type InMemoryAdminHandler = (input: AdminRequestInput) => unknown | Promise<unknown>

export function createInMemoryAdminTransport(
  handlers: Readonly<Record<string, InMemoryAdminHandler>>,
): AdminTransport {
  return {
    async request<T>(request: AdminRequest) {
      const handler = Object.hasOwn(handlers, request.action) ? handlers[request.action] : undefined
      if (!handler) {
        throw new MipAdminError('NOT_FOUND', '运营操作不存在')
      }
      const input = { ...request.input }
      if (Object.hasOwn(request, 'idempotencyKey')) {
        input.idempotencyKey = request.idempotencyKey
      }
      try {
        return await handler(input) as T
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
