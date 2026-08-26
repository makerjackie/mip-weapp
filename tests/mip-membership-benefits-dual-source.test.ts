import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { presentMembershipBenefits } from '../src/packages/member/benefits/presentation'

const manual = {
  entitlementId: 'manual-entitlement',
  sourceType: 'ADMIN_ADJUSTMENT',
  sourceLabel: '运营开通',
  status: 'ACTIVE',
  startsAt: '2030-08-01T00:00:00.000Z',
  endsAt: '2031-08-01T00:00:00.000Z',
}

const order = {
  entitlementId: 'order-entitlement',
  sourceType: 'ORDER',
  sourceLabel: '会员购买',
  status: 'SCHEDULED',
  startsAt: '2031-08-01T00:00:00.000Z',
  endsAt: '2032-08-01T00:00:00.000Z',
  orderId: 'order-a',
  plan: { id: 'plan-a', name: '年度会员' },
  price: { amountCents: 79900, currency: 'CNY' },
  invitationAttribution: { sourceType: 'PLATFORM', displayName: 'MIP 平台' },
}

describe('member benefit dual-source presentation', () => {
  it('renders manual-only membership without a fake plan or internal adjustment facts', () => {
    const result = presentMembershipBenefits({
      kind: 'PLAYER',
      sourceType: 'ADMIN_ADJUSTMENT',
      sourceLabel: '运营开通',
      startsAt: manual.startsAt,
      endsAt: manual.endsAt,
      membershipEndsAt: manual.endsAt,
      benefits: [],
      history: [{ ...manual, reason: '内部原因', actorUserId: 'admin-a' }],
    })

    expect(result).toMatchObject({
      membershipLabel: '玩家',
      membershipDescription: '运营开通',
      currentSourceText: '运营开通',
      planEndsText: '2031-08-01',
      isPlayer: true,
    })
    expect(result.membershipHistory[0]).toEqual({
      entitlementId: 'manual-entitlement',
      sourceType: 'ADMIN_ADJUSTMENT',
      sourceLabel: '运营开通',
      title: '运营开通',
      status: 'ACTIVE',
      statusLabel: '有效',
      startsText: '2030-08-01',
      endsText: '2031-08-01',
      planName: '',
    })
    expect(JSON.stringify(result)).not.toMatch(/内部原因|admin-a|reason|actor/)
  })

  it('keeps manual and ORDER windows distinct in mixed history', () => {
    const result = presentMembershipBenefits({
      kind: 'PLAYER',
      sourceType: 'ADMIN_ADJUSTMENT',
      sourceLabel: '运营开通',
      startsAt: manual.startsAt,
      endsAt: manual.endsAt,
      membershipEndsAt: order.endsAt,
      history: [manual, order],
    })

    expect(result.membershipEndsText).toBe('2032-08-01')
    expect(result.membershipHistory.map(item => ({
      sourceType: item.sourceType,
      title: item.title,
      status: item.status,
    }))).toEqual([
      { sourceType: 'ADMIN_ADJUSTMENT', title: '运营开通', status: 'ACTIVE' },
      { sourceType: 'ORDER', title: '年度会员', status: 'SCHEDULED' },
    ])
  })

  it('preserves ORDER plan benefits and keeps checkout navigation visible for players', () => {
    const result = presentMembershipBenefits({
      kind: 'PLAYER',
      sourceType: 'ORDER',
      sourceLabel: '会员购买',
      plan: { id: 'plan-a', name: '年度会员', description: '会员说明' },
      startsAt: '2030-08-01T00:00:00.000Z',
      endsAt: '2031-08-01T00:00:00.000Z',
      membershipEndsAt: '2031-08-01T00:00:00.000Z',
      benefits: [{ key: 'events', label: '会员活动权益', status: 'ACTIVE' }],
      history: [{ ...order, status: 'ACTIVE' }],
    })
    expect(result).toMatchObject({
      membershipDescription: '会员说明',
      currentSourceText: '年度会员',
      activeBenefits: [{ key: 'events', label: '会员活动权益', status: 'ACTIVE' }],
    })

    const template = readFileSync(new URL('../src/packages/member/benefits/index.wxml', import.meta.url), 'utf8')
    expect(template).toContain('membershipKnown && state === \'ready\' && plans.length')
    expect(template).not.toContain('membershipKnown && !isPlayer')
  })

  it('does not guess ORDER for an unknown player source or malformed history association', () => {
    const result = presentMembershipBenefits({
      kind: 'PLAYER',
      sourceType: 'UNKNOWN',
      startsAt: '2030-08-01T00:00:00.000Z',
      endsAt: '2031-08-01T00:00:00.000Z',
      membershipEndsAt: '2031-08-01T00:00:00.000Z',
      history: [{ ...order, sourceType: 'UNKNOWN' }, { ...order, orderId: '' }],
    })
    expect(result).toMatchObject({ membershipLabel: '嘉宾', isPlayer: false })
    expect(result.membershipHistory).toEqual([])
  })
})
