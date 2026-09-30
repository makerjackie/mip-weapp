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
    expect(ordersSource).toContain('mipCommerceModule.listOrderPage(')
    expect(ordersSource).toContain('serviceStatus: filter')
    expect(ordersSource).not.toContain('order.status === filter')
    expect(detailView).toContain('使用状态')
    expect(detailView).toContain('订单状态')
  })

  it('keeps pending event payment status and continuation visible before scrolling', () => {
    const eventPaymentState = detailView.indexOf('wx:if="{{paymentPending}}" class="mt-3 rounded-[16rpx]')
    const priceDetails = detailView.indexOf('费用明细', eventPaymentState)
    const fixedPaymentAction = detailView.indexOf('<mip-sticky-actions')

    expect(eventPaymentState).toBeGreaterThan(-1)
    expect(eventPaymentState).toBeLessThan(priceDetails)
    expect(detailView.slice(eventPaymentState, priceDetails)).toContain('订单尚未支付，报名尚未生效')
    expect(detailView.slice(eventPaymentState, priceDetails)).toContain('支付结果尚未确认，报名资格暂未生效')
    expect(fixedPaymentAction).toBeGreaterThan(-1)
    expect(detailView.slice(fixedPaymentAction)).toContain('\'继续支付\'')
    expect(detailView).not.toContain('wx:if="{{paymentPending}}" block size="large"')
  })
})
