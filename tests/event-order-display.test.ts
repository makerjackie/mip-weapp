import { beforeAll, expect, it, vi } from 'vitest'

const commerce = vi.hoisted(() => ({ listOrderPage: vi.fn(), listPlans: vi.fn() }))
vi.mock('../src/modules/mip-commerce/client', () => ({ mipCommerceModule: commerce }))
vi.mock('../src/modules/mip-events/client', () => ({ mipEventsModule: {}, mipCheckInResumeStore: {} }))
vi.mock('../src/modules/mip-identity/client', () => ({ mipIdentityModule: {} }))
vi.mock('../src/modules/mip-messaging/client', () => ({ mipMessagingModule: {} }))
vi.mock('../src/platform/navigation/client', () => ({ caseNavigateTo: vi.fn(), caseRedirectTo: vi.fn() }))
vi.mock('../src/platform/storage/component-media', () => ({ updatePageMedia: vi.fn(), clearPageMedia: vi.fn() }))
interface Definition { data: Record<string, unknown>, [key: string]: unknown }
let captured: Definition
let list: Definition
let detail: Definition
function page(definition: Definition) {
  const instance = Object.create(definition) as Definition
  instance.data = structuredClone(definition.data)
  instance.setData = (values: Record<string, unknown>) => Object.assign(instance.data, values)
  return instance
}
function call(instance: Definition, name: string, ...args: unknown[]) {
  return Reflect.apply(instance[name] as (...args: unknown[]) => unknown, instance, args)
}
function order(status: string, extra = {}) {
  return {
    id: status,
    userId: 'user',
    orderType: 'EVENT',
    resourceId: 'event',
    amountCents: 1990,
    refundedAmountCents: 0,
    currency: 'CNY',
    status,
    serviceStatus: 'UNAVAILABLE',
    version: 1,
    createdAt: '2026-11-06T01:00:00Z',
    event: { title: '图文活动', startsAt: '2026-11-06T02:00:00Z', endsAt: '2026-11-06T04:00:00Z' },
    ...extra,
  }
}
beforeAll(async () => {
  vi.stubGlobal('Page', (definition: Definition) => {
    captured = definition
  })
  await import('../src/packages/member/orders/index')
  list = captured
  await import('../src/packages/member/order-detail/index')
  detail = captured
})
it('keeps nonempty unpaid/paid/refunded event order amounts honest', async () => {
  commerce.listOrderPage.mockResolvedValue({ items: [order('CLOSED'), order('CREATED'), order('PAID'), order('REFUNDED', { serviceStatus: 'REFUNDED', refundedAmountCents: 1990 })] })
  commerce.listPlans.mockResolvedValue([])
  const instance = page(list)
  await call(instance, 'fetchOrders', false)
  const records = instance.data.orders as Array<Record<string, unknown>>
  expect(instance.data.state).toBe('ready')
  expect(records.map(item => item.amountLabel)).toEqual(['订单金额', '订单金额', '实付款', '已退款'])
  expect(records.map(item => item.amountText)).toEqual(['¥19.90', '¥19.90', '¥19.90', '¥19.90'])
})
it('shows the same Beijing activity time in orders and order details on a New York device', async () => {
  const old = process.env.TZ
  process.env.TZ = 'America/New_York'
  try {
    const value = order('CLOSED')
    commerce.listOrderPage.mockResolvedValue({ items: [value] })
    commerce.listPlans.mockResolvedValue([])
    const orders = page(list)
    await call(orders, 'fetchOrders', false)
    const item = (orders.data.orders as Array<Record<string, unknown>>)[0]
    const receipt = page(detail)
    call(receipt, 'applyOrder', value, [])
    expect(item.eventStartsText).toBe('2026年11月6日 10:00')
    expect(receipt.data.eventStartsText).toBe(item.eventStartsText)
    expect(receipt.data.eventEndsText).toBe('2026年11月6日 12:00')
    expect(receipt.data.paidText).toBe('')
  }
  finally {
    if (old === undefined) {
      delete process.env.TZ
    }
    else { process.env.TZ = old }
  }
})
