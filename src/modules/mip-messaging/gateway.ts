import type {
  MipMessagingAction,
  MipMessagingActionInputMap,
  MipMessagingActionResultMap,
  MipMessagingGateway,
  MipMessagingRequest,
} from './types'
import { MIP_MESSAGING_CONTRACT_VERSION, MipMessagingError } from './types'

interface Envelope<T> {
  ok: boolean
  data?: T
  error?: { code?: string, message?: string, retryable?: boolean }
}

export interface MipMessagingTransport {
  invoke: <A extends MipMessagingAction>(request: MipMessagingRequest<A>) => Promise<unknown>
}

function unwrap<T>(value: unknown): T {
  if (!value || typeof value !== 'object' || typeof (value as Envelope<T>).ok !== 'boolean') {
    throw new MipMessagingError('SERVICE_UNAVAILABLE', '消息服务返回了无效响应', true)
  }
  const envelope = value as Envelope<T>
  if (!envelope.ok || envelope.data === undefined) {
    throw new MipMessagingError(
      envelope.error?.code || 'SERVICE_UNAVAILABLE',
      envelope.error?.message || '消息服务请求失败',
      envelope.error?.retryable === true,
    )
  }
  return envelope.data
}

export function createMipMessagingGateway(transport: MipMessagingTransport): MipMessagingGateway {
  async function call<A extends MipMessagingAction>(
    action: A,
    input: MipMessagingActionInputMap[A],
  ): Promise<MipMessagingActionResultMap[A]> {
    return unwrap<MipMessagingActionResultMap[A]>(await transport.invoke({
      contractVersion: MIP_MESSAGING_CONTRACT_VERSION,
      action,
      input,
    }))
  }

  return {
    listInbox: (cursor, limit) => call('listInbox', { cursor, limit }),
    markRead: messageId => call('markRead', { messageId }),
    recordCustomerServiceInteraction: () => call('recordCustomerServiceInteraction', {}),
    recordSubscriptionDecision: (templateKey, decision) => call('recordSubscriptionDecision', {
      templateKey,
      decision,
    }),
  }
}
