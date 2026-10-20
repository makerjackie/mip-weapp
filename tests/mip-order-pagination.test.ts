import type { CommerceOrder, CommerceOrderPage } from '../src/modules/mip-commerce'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ listOrderPage: vi.fn(), listPlans: vi.fn() }))
vi.mock('../src/modules/mip-commerce/client', () => ({ mipCommerceModule: mocks }))
vi.mock('../src/platform/navigation/client', () => ({ caseNavigateTo: vi.fn() }))

interface TestPage {
  data: { orders: CommerceOrder[], nextCursor: string, filter: string, state: string, message: string }
  setData: (patch: Record<string, unknown>) => void
  loadOrders: () => Promise<void>
  loadMore: () => Promise<void>
  changeFilter: (event: unknown) => void
}
let definition: TestPage
function page() {
  const instance = Object.create(definition) as TestPage
  instance.data = structuredClone(definition.data)
  instance.setData = patch => Object.assign(instance.data, patch)
  return instance
}
function order(id: string): CommerceOrder {
  return { id, orderType: 'CONTENT', amountCents: 100, refundedAmountCents: 0, currency: 'CNY', status: 'PAID', serviceStatus: 'PENDING_USE', version: 1 } as CommerceOrder
}
function deferred() {
  let resolve!: (value: CommerceOrderPage) => void
  const promise = new Promise<CommerceOrderPage>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

beforeAll(async () => {
  vi.stubGlobal('Page', (value: TestPage) => {
    definition = value
  })
  await import('../src/packages/member/orders/index')
})
beforeEach(() => {
  mocks.listOrderPage.mockReset()
  mocks.listPlans.mockReset().mockResolvedValue([])
})

afterAll(() => vi.unstubAllGlobals())

describe('order pagination and server filtering', () => {
  it('appends older orders and keeps the cursor for retry after a failed page', async () => {
    mocks.listOrderPage.mockResolvedValueOnce({ items: [order('new')], nextCursor: 'older' })
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ items: [order('new'), order('old')] })
    const instance = page()
    await instance.loadOrders()
    await instance.loadMore()
    expect(instance.data.orders.map(item => item.id)).toEqual(['new'])
    expect(instance.data.nextCursor).toBe('older')
    await instance.loadMore()
    expect(mocks.listOrderPage).toHaveBeenLastCalledWith({ cursor: 'older' })
    expect(instance.data.orders.map(item => item.id)).toEqual(['new', 'old'])
    expect(instance.data.nextCursor).toBe('')
    await instance.loadMore()
    expect(mocks.listOrderPage).toHaveBeenCalledTimes(3)
  })

  it('queries the selected service status and discards a late page from the previous tab', async () => {
    const oldPage = deferred()
    mocks.listOrderPage.mockResolvedValueOnce({ items: [order('all')], nextCursor: 'all-next' })
      .mockReturnValueOnce(oldPage.promise)
      .mockResolvedValueOnce({ items: [order('older-pending')] })
    const instance = page()
    await instance.loadOrders()
    const pending = instance.loadMore()
    instance.changeFilter({ currentTarget: { dataset: { filter: 'PENDING_USE' } } })
    await vi.waitFor(() => expect(instance.data.orders.map(item => item.id)).toEqual(['older-pending']))
    expect(mocks.listOrderPage).toHaveBeenLastCalledWith({ serviceStatus: 'PENDING_USE' })
    oldPage.resolve({ items: [order('wrong-tab')], nextCursor: 'wrong-cursor' })
    await pending
    expect(instance.data.orders.map(item => item.id)).toEqual(['older-pending'])
    expect(instance.data.nextCursor).toBe('')
  })
})

it('reveals nonempty membership orders while the optional plan catalogue is still pending', async () => {
  mocks.listOrderPage.mockResolvedValue({ items: [{ ...order('member-order'), orderType: 'MEMBERSHIP' }], nextCursor: '' })
  mocks.listPlans.mockReturnValueOnce(new Promise(() => {}))
  const instance = page()
  await instance.loadOrders()
  expect(instance.data.state).toBe('ready')
  expect(instance.data.orders[0].id).toBe('member-order')
  expect(instance.data).toMatchObject({ refreshing: false, loadingMore: false })
})

it('does not request membership plans for a content-only order list', async () => {
  mocks.listOrderPage.mockResolvedValue({ items: [order('content-order')] })
  const instance = page()
  await instance.loadOrders()
  expect(instance.data.orders).toHaveLength(1)
  expect(mocks.listPlans).not.toHaveBeenCalled()
})
