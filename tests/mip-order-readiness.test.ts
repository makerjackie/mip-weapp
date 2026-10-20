import { beforeAll, beforeEach, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({ getOrder: vi.fn(), reconcile: vi.fn(), listPlans: vi.fn() }))
vi.mock('../src/modules/mip-commerce/client', () => ({ mipCommerceModule: api }))
vi.mock('../src/modules/mip-events/client', () => ({ mipEventsModule: {}, mipCheckInResumeStore: {} }))
vi.mock('../src/modules/mip-identity/client', () => ({ mipIdentityModule: {} }))
vi.mock('../src/modules/mip-messaging/client', () => ({ mipMessagingModule: {} }))
vi.mock('../src/platform/navigation/client', () => ({ caseNavigateTo: vi.fn(), caseRedirectTo: vi.fn() }))
vi.mock('../src/platform/storage/component-media', () => ({ updatePageMedia: vi.fn(), clearPageMedia: vi.fn() }))
let definition: Record<string, any>
beforeAll(async () => {
  vi.stubGlobal('Page', (value: Record<string, any>) => {
    definition = value
  })
  await import('../src/packages/member/order-detail/index')
})
beforeEach(() => vi.resetAllMocks())
function page() {
  const value = Object.create(definition)
  value.data = structuredClone(definition.data)
  value.data.orderId = 'order-1'
  value.setData = (patch: Record<string, unknown>) => Object.assign(value.data, patch)
  return value
}
const order = { id: 'order-1', orderType: 'MEMBERSHIP', status: 'CREATED', serviceStatus: 'UNAVAILABLE', amountCents: 100, refundedAmountCents: 0, version: 1 }

it('shows the server pending order before provider reconciliation, then applies its real result', async () => {
  let reconcile!: (value: unknown) => void
  api.getOrder.mockResolvedValue(order)
  api.listPlans.mockReturnValue(new Promise(() => {}))
  api.reconcile.mockReturnValue(new Promise((resolve) => {
    reconcile = resolve
  }))
  const instance = page()
  const loading = instance.load()
  await vi.waitFor(() => expect(instance.data.state).toBe('ready'))
  expect(instance.data.order.status).toBe('CREATED')
  reconcile({ ...order, status: 'PAID', version: 2 })
  await loading
  expect(instance.data.order).toMatchObject({ status: 'PAID', version: 2 })
})

it('discards reconciliation that arrives after the detail page has unloaded', async () => {
  let reconcile!: (value: unknown) => void
  api.getOrder.mockResolvedValue(order)
  api.listPlans.mockResolvedValue([])
  api.reconcile.mockReturnValue(new Promise((resolve) => {
    reconcile = resolve
  }))
  const instance = page()
  const loading = instance.load()
  await vi.waitFor(() => expect(instance.data.state).toBe('ready'))
  instance.onUnload()
  reconcile({ ...order, status: 'PAID', version: 2 })
  await loading
  expect(instance.data.order.version).toBe(1)
})
