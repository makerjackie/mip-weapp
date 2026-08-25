import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function read(relativePath: string) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

const recordColumns = 'minmax(0, 1.35fr) minmax(0, 1.65fr) minmax(0, 1.25fr) minmax(0, 1.45fr)'

describe('admin orders responsive record workspace', () => {
  it('uses the shared phone, tablet, and desktop record contract', () => {
    const source = read('src/packages/admin/orders/index.wxml')

    expect(source).toContain(`class="mip-admin-record-list mt-5" style="--mip-admin-record-columns: ${recordColumns};"`)
    expect(source).toContain('class="mip-admin-record-header"')
    expect(source).toContain('class="mip-admin-record-row"')
    expect(source.match(/class="mip-admin-record-cell"/g)).toHaveLength(4)
    expect(source.match(/class="mip-admin-record-label"/g)).toHaveLength(4)
    for (const label of ['用户与订单', '业务资源', '金额与时间', '状态与操作']) {
      expect(source).toContain(`<view class="mip-admin-record-label">${label}</view>`)
    }
    expect(source).not.toContain('mip-admin-card-list mt-5')
  })

  it('keeps long server-projected identifiers and titles shrinkable', () => {
    const source = read('src/packages/admin/orders/index.wxml')

    expect(source).toContain('class="mt-1 break-all text-[length:21rpx] text-muted">订单号：{{item.merchantOrderNoMasked}}')
    expect(source).toContain('class="break-all text-[length:24rpx] font-semibold">{{item.resourceTitle}}')
    expect(source).toContain('class="mt-2 break-all text-[length:21rpx] text-muted">微信支付单号：{{item.providerTransactionIdMasked}}')
    expect(source).toContain('class="mt-2 break-all text-[length:21rpx] text-muted">会员权益有效期：{{item.entitlementWindowText}}')
  })

  it('preserves server-owned financial facts, action gates, and page handlers', () => {
    const source = read('src/packages/admin/orders/index.wxml')
    const page = read('src/packages/admin/orders/index.ts')

    for (const projection of [
      'item.amountText',
      'item.refundedText',
      'item.refundStatusText',
      'item.createdText',
      'item.paidText',
    ]) {
      expect(source).toContain(projection)
    }
    expect(source).not.toMatch(/amountCents\s*[/*+-]/)
    expect(source).not.toMatch(/refundedAmountCents\s*[/*+-]/)
    expect(page).toContain(`canSubmitRefund: item.availableRefundActions.includes('SUBMIT_REFUND')`)
    expect(page).toContain(`canRetryRefund: item.availableRefundActions.includes('RETRY_REFUND')`)
    expect(page).toContain(`KNOWLEDGE_CONTENT: '内容商品'`)
    expect(source).toContain('item.resourceTypeText')
    expect(source).not.toContain('item.resourceType === \'EVENT\' ? \'活动\' : \'会员方案\'')
    expect(source).toContain(`item.canSubmitRefund && (item.status === 'PAID' || item.status === 'PARTIALLY_REFUNDED')`)
    expect(source).toContain(`item.canRetryRefund && item.status === 'REFUND_PENDING' && item.refundId`)
    for (const binding of [
      'bind:tap="search"',
      'bindchange="changeOrderType"',
      'bindchange="changeStatus"',
      'bindchange="changeRefundStatus"',
      'bindchange="changeCreatedDate"',
      'bind:tap="clearCreatedDates"',
      'bind:tap="createExport"',
      'bind:tap="submitRefund"',
      'bind:tap="retryRefund"',
      'bind:tap="loadMoreOrders"',
      'bind:action="loadOrders"',
    ]) {
      expect(source).toContain(binding)
    }
  })

  it('retains summary, pagination, and all terminal page states', () => {
    const source = read('src/packages/admin/orders/index.wxml')

    expect(source).toContain(`state === 'ready'`)
    expect(source).toContain(`state === 'loading'`)
    expect(source).toContain(`state === 'error' || state === 'conflict'`)
    expect(source).toContain(`state === 'forbidden'`)
    expect(source).toContain('orders.length === 0')
    expect(source).toContain('wx:if="{{nextCursor}}"')
    for (const projection of [
      'summary.orderCount',
      'summary.paidOrderCount',
      'summary.eventGrossText',
      'summary.membershipGrossText',
      'summary.grossText',
      'summary.refundedText',
      'summary.netText',
    ]) {
      expect(source).toContain(projection)
    }
  })
})
