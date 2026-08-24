import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const ordersSource = readFileSync(new URL('../src/packages/member/orders/index.ts', import.meta.url), 'utf8')
const ordersView = readFileSync(new URL('../src/packages/member/orders/index.wxml', import.meta.url), 'utf8')
const detailView = readFileSync(new URL('../src/packages/member/order-detail/index.wxml', import.meta.url), 'utf8')

describe('member order service status contract', () => {
  it('uses the four product tabs and server service status values', () => {
    for (const label of ['全部', '待使用', '已完成', '已退款']) {
      expect(ordersView).toContain(`>${label}</view>`)
    }
    for (const value of ['PENDING_USE', 'COMPLETED', 'REFUNDED']) {
      expect(ordersView).toContain(`data-filter="${value}"`)
    }
    expect(ordersView).not.toContain('待确认')
    expect(ordersView).not.toContain('data-filter="paid"')
  })

  it('filters only on the server projection and keeps payment status separate', () => {
    const start = ordersSource.indexOf('function filterOrders')
    const end = ordersSource.indexOf('\n}\n\nPage(', start) + 2
    const filterSource = ordersSource.slice(start, end)
    expect(filterSource).toContain('order.serviceStatus === filter')
    expect(filterSource).not.toContain('order.status')
    expect(filterSource).not.toContain('paymentPending')
    expect(detailView).toContain('使用状态')
    expect(detailView).toContain('订单状态')
  })
})
