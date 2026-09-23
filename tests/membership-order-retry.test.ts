import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const commerce = vi.hoisted(() => ({ purchase: vi.fn() }))
const navigation = vi.hoisted(() => ({ redirect: vi.fn(), navigate: vi.fn() }))
const intent = vi.hoisted(() => ({ create: vi.fn() }))

vi.mock('../src/config/runtime', () => ({ runtimeConfig: { paymentMode: 'test' } }))
vi.mock('../src/modules/mip-commerce/client', () => ({ mipCommerceModule: { purchase: commerce.purchase } }))
vi.mock('../src/modules/mip-commerce', () => ({ MipCommerceError: class extends Error { code = '' } }))
vi.mock('../src/modules/mip-identity/client', () => ({ mipIdentityModule: {} }))
vi.mock('../src/modules/mip-identity', () => ({ mipAccessPageUrl: vi.fn() }))
vi.mock('../src/modules/mip-shell', () => ({ createIntentKey: intent.create }))
vi.mock('../src/platform/navigation/client', () => ({
  caseNavigateTo: navigation.navigate,
  caseRedirectTo: navigation.redirect,
}))

interface PageDefinition {
  data: Record<string, unknown>
  [key: string]: unknown
}

let definition: PageDefinition

function page() {
  return Object.assign(Object.create(definition) as PageDefinition, {
    data: structuredClone(definition.data),
    setData(patch: Record<string, unknown>) { Object.assign(this.data, patch) },
  })
}

async function purchase(instance: PageDefinition) {
  const handler = instance.performPurchase
  if (typeof handler !== 'function') {
    throw new TypeError('Missing purchase handler')
  }
  await Reflect.apply(handler, instance, ['plan-1'])
}

beforeAll(async () => {
  vi.stubGlobal('Page', (value: PageDefinition) => {
    definition = value
  })
  await import('../src/packages/member/membership-order/index')
})

beforeEach(() => {
  vi.clearAllMocks()
  let index = 0
  intent.create.mockImplementation(() => `membership-order-${++index}`)
})

describe('membership order retry and result flow', () => {
  it('reuses the same order identity after an uncertain failure and shows the result page', async () => {
    commerce.purchase
      .mockRejectedValueOnce(new Error('network response lost'))
      .mockResolvedValueOnce({ kind: 'PENDING', order: { id: 'order-1' } })
    const instance = page()

    await purchase(instance)
    expect(instance.data.message).toBe('暂时无法发起支付，请稍后重试。')
    await purchase(instance)

    expect(commerce.purchase).toHaveBeenCalledTimes(2)
    expect(commerce.purchase.mock.calls[0]?.[0].idempotencyKey).toBe(
      commerce.purchase.mock.calls[1]?.[0].idempotencyKey,
    )
    expect(navigation.redirect).toHaveBeenCalledWith({
      url: '/packages/member/payment-result/index?orderId=order-1',
    })
  })

  it('starts a new order only after an explicit payment cancellation', async () => {
    commerce.purchase
      .mockResolvedValueOnce({ kind: 'CANCELLED' })
      .mockResolvedValueOnce({ kind: 'CONFIRMED', order: { id: 'order-2' } })
    const instance = page()

    await purchase(instance)
    await purchase(instance)

    expect(commerce.purchase.mock.calls[0]?.[0].idempotencyKey).not.toBe(
      commerce.purchase.mock.calls[1]?.[0].idempotencyKey,
    )
    expect(navigation.redirect).toHaveBeenCalledWith({
      url: '/packages/member/payment-result/index?orderId=order-2',
    })
  })
})
