import type { MipAdminGateway } from './types'

interface OrdersAdminCache {
  query: <T>(key: string, loader: () => Promise<T>, options?: { force?: boolean }) => Promise<T>
  invalidate: (prefix?: string) => void
}

type OrderListInput = NonNullable<Parameters<MipAdminGateway['listOrders']>[0]>

export interface MipOrdersAdmin {
  list: (
    input?: OrderListInput,
    force?: boolean,
  ) => ReturnType<MipAdminGateway['listOrders']>
  submitRefund: MipAdminGateway['submitRefund']
  retryRefund: MipAdminGateway['retryRefund']
}

const ordersCacheKey = 'mip-admin:orders'

export function createMipOrdersAdmin(
  gateway: MipAdminGateway,
  cache: OrdersAdminCache,
): MipOrdersAdmin {
  const mutate = async <T>(work: () => Promise<T>) => {
    const result = await work()
    cache.invalidate(ordersCacheKey)
    return result
  }

  return {
    list: (input: OrderListInput = {}, force = false) => cache.query(
      `${ordersCacheKey}:${JSON.stringify(input)}`,
      () => gateway.listOrders(input),
      { force },
    ),
    submitRefund: input => mutate(() => gateway.submitRefund(input)),
    retryRefund: refundId => mutate(() => gateway.retryRefund(refundId)),
  }
}
