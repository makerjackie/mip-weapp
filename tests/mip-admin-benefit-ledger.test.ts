import { describe, expect, it } from 'vitest'
import { parseAdminUnifiedBenefitLedgerPage } from '../src/modules/mip-admin/benefit-ledger'

function item() {
  return {
    benefitType: 'MEMBERSHIP',
    nickname: '测试用户',
    playerNumber: 42,
    benefitName: '年度会员',
    status: 'ACTIVE',
    startsAt: '2030-01-01T00:00:00.000Z',
    endsAt: '2031-01-01T00:00:00.000Z',
    occurredAt: '2030-01-01T00:00:00.000Z',
    sourceType: 'ORDER',
    metric: null,
    deltaValue: null,
    order: {
      status: 'PAID',
      orderType: 'MEMBERSHIP',
      amountCents: 660000,
      paidAt: '2030-01-01T00:00:00.000Z',
    },
  }
}

describe('admin unified benefit ledger operator contract', () => {
  it('accepts redacted membership rows and rejects internal source identifiers', () => {
    expect(parseAdminUnifiedBenefitLedgerPage({ items: [item()], nextCursor: 'opaque-cursor' }))
      .toMatchObject({ items: [{ nickname: '测试用户', playerNumber: 42 }], nextCursor: 'opaque-cursor' })
    expect(() => parseAdminUnifiedBenefitLedgerPage({
      items: [{ ...item(), sourceId: 'internal-uuid' }],
      nextCursor: null,
    })).toThrow('统一权益流水')
    expect(() => parseAdminUnifiedBenefitLedgerPage({ items: [], nextCursor: null, extra: true }))
      .toThrow('统一权益流水')
  })
})
