import type { CallerCapabilities, OrderId, UserId } from '../src/modules/mip'
import type { CommerceOrder, OrderServiceStatus, OrderStatus } from '../src/modules/mip-commerce'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  canManageEvents,
  classifyPaymentResult,
  createIntentKey,
  formatCny,
  hasCapability,
  membershipPresentation,
  presentOrderServiceStatus,
  presentOrderStatus,
} from '../src/modules/mip-shell'

function order(status: OrderStatus, serviceStatus: OrderServiceStatus = 'UNAVAILABLE'): CommerceOrder {
  return {
    id: '00000000-0000-4000-8000-000000000001' as OrderId,
    userId: '00000000-0000-4000-8000-000000000002' as UserId,
    orderType: 'MEMBERSHIP',
    amountCents: 19900,
    refundedAmountCents: 0,
    currency: 'CNY',
    status,
    serviceStatus,
    version: 1,
  }
}

describe('MIP shell presentation', () => {
  it('only treats server PAID as payment success', () => {
    expect(classifyPaymentResult(order('CREATED'))).toBe('pending')
    expect(classifyPaymentResult(order('PAYMENT_CREATED'))).toBe('pending')
    expect(classifyPaymentResult(order('PAID'))).toBe('success')
    expect(classifyPaymentResult(order('FAILED'))).toBe('failed')
  })

  it('only exposes refund actions for server refundable states', () => {
    expect(presentOrderStatus('PAID').refundable).toBe(true)
    expect(presentOrderStatus('PARTIALLY_REFUNDED').refundable).toBe(true)
    expect(presentOrderStatus('REFUND_PENDING').refundable).toBe(false)
    expect(presentOrderStatus('REFUNDED').refundable).toBe(false)
  })

  it('presents service lifecycle separately from payment state', () => {
    expect(presentOrderServiceStatus('PENDING_USE')).toMatchObject({ label: '待使用', tone: 'brand' })
    expect(presentOrderServiceStatus('COMPLETED')).toMatchObject({ label: '已完成', tone: 'success' })
    expect(presentOrderServiceStatus('REFUNDED')).toMatchObject({ label: '已退款', tone: 'neutral' })
    expect(presentOrderServiceStatus('UNAVAILABLE').label).toBe('')
  })

  it('projects player only from an active entitlement fact', () => {
    expect(membershipPresentation('PLAYER', {
      status: 'ACTIVE',
      startsAt: '2026-01-01T00:00:00.000Z',
      endsAt: '2027-01-01T00:00:00.000Z',
    }).label).toBe('玩家')
    expect(membershipPresentation('GUEST').label).toBe('嘉宾')
    expect(membershipPresentation('PLAYER', {
      status: 'EXPIRED',
      startsAt: '2025-01-01T00:00:00.000Z',
      endsAt: '2026-01-01T00:00:00.000Z',
    }).label).toBe('嘉宾')
  })

  it('uses server capability grants for management entry', () => {
    const grants: CallerCapabilities[] = [{
      scopeType: 'EVENT',
      scopeId: 'event-1',
      roles: ['EVENT_STAFF'],
      capabilities: ['admin:enter', 'event:check_in'],
    }]
    expect(hasCapability(grants, 'admin:enter')).toBe(true)
    expect(canManageEvents(grants)).toBe(true)
    expect(hasCapability(grants, 'finance:manage')).toBe(false)
  })

  it('formats money and creates bounded intent keys', () => {
    expect(formatCny(19900)).toBe('¥199.00')
    expect(formatCny(-1)).toBe('—')
    expect(createIntentKey('Membership Checkout', 1_700_000_000_000, 0.25))
      .toMatch(/^membership-checkout-[a-z0-9]+-[a-z0-9]+$/)
  })

  it('keeps city branch discovery public and leaves mutation gating to the branch page', () => {
    const homeSource = readFileSync(new URL('../src/pages/index/index.ts', import.meta.url), 'utf8')
    const start = homeSource.indexOf('openBranches() {')
    const end = homeSource.indexOf('\n  },', start)
    const openBranches = homeSource.slice(start, end)

    expect(openBranches).toContain('caseNavigateTo')
    expect(openBranches).toContain('/packages/member/mip-branches/index')
    expect(openBranches).not.toContain('beginProtectedAction')
  })
})
