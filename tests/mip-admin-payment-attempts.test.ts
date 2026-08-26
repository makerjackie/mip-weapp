import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseAdminPaymentAttemptPage } from '../src/modules/mip-admin/payment-attempts'

const root = path.resolve(import.meta.dirname, '..')

function item() {
  return {
    id: 'attempt-001',
    orderId: 'order-001',
    orderNumberMasked: 'MIP-…0001',
    nickname: '测试用户',
    playerNumber: 42,
    provider: 'WECHAT_PAY',
    status: 'FAILED',
    providerPaymentIdMasked: 'prov…1234',
    requiresAttention: true,
    orderType: 'MEMBERSHIP',
    orderTitle: '年度会员',
    amountCents: 660000,
    currency: 'CNY',
    createdAt: '2030-01-01T00:00:00.000Z',
    updatedAt: '2030-01-01T00:01:00.000Z',
  }
}

describe('admin payment attempt operator contract', () => {
  it('accepts redacted rows and rejects raw provider response fields', () => {
    expect(parseAdminPaymentAttemptPage({ items: [item()], nextCursor: 'opaque-cursor' }))
      .toMatchObject({ items: [{ nickname: '测试用户', playerNumber: 42 }], nextCursor: 'opaque-cursor' })
    expect(() => parseAdminPaymentAttemptPage({
      items: [{ ...item(), providerResponse: { secret: 'raw' } }],
      nextCursor: null,
    })).toThrow('支付尝试记录')
  })

  it('exposes neutral filters, pagination and order navigation without raw identifiers', () => {
    const page = fs.readFileSync(path.join(root, 'src/packages/admin/payment-attempts/index.wxml'), 'utf8')
    expect(page).toContain('搜索昵称、玩家编号或订单号')
    expect(page).toContain('暂无支付尝试记录')
    expect(page).toContain('加载更多')
    expect(page).toContain('查看订单')
    expect(page).not.toContain('providerResponse')
    expect(page).not.toContain('lastErrorCode')
  })
})
