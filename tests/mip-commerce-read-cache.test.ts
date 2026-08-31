import type { CommerceGateway, MembershipBenefitsSnapshot, MembershipPlan, PaymentAdapter } from '../src/modules/mip-commerce'
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { createMembershipPlanCache, createMipCommerceModule } from '../src/modules/mip-commerce'

const plan: MembershipPlan = {
  id: 'plan-1' as MembershipPlan['id'],
  planKey: 'annual-player',
  catalogStage: 'TEST',
  name: '一年会员',
  description: '服务端会员方案',
  durationDays: 365,
  priceCents: 600000,
  currency: 'CNY',
  benefits: ['会员活动权益'],
  status: 'ACTIVE',
  version: 1,
}

const guest: MembershipBenefitsSnapshot = {
  kind: 'GUEST',
  status: 'NONE',
  benefits: [],
  history: [],
}

function gateway(overrides: Partial<CommerceGateway> = {}): CommerceGateway {
  return {
    listPlans: vi.fn(async () => [plan]),
    getMembershipBenefits: vi.fn(async () => guest),
    createMembershipInvitation: vi.fn(),
    createMembershipInvitationCode: vi.fn(),
    resolveMembershipInvitationScene: vi.fn(),
    createCheckout: vi.fn(),
    createPayment: vi.fn(),
    getOrder: vi.fn(),
    reconcileOrder: vi.fn(),
    listOrders: vi.fn(async () => []),
    requestRefund: vi.fn(),
    submitRefund: vi.fn(),
    ...overrides,
  }
}

const payment: PaymentAdapter = { request: vi.fn() }

describe('MIP commerce read cache', () => {
  it('renders shared server facts before starting background revalidation', () => {
    const membershipPage = readFileSync(new URL('../src/pages/membership/index.ts', import.meta.url), 'utf8')
    const membershipView = readFileSync(new URL('../src/pages/membership/index.wxml', import.meta.url), 'utf8')
    const benefitsPage = readFileSync(new URL('../src/packages/member/benefits/index.ts', import.meta.url), 'utf8')

    expect(membershipPage.indexOf('mipCommerceModule.peekPlans()'))
      .toBeLessThan(membershipPage.indexOf('mipCommerceModule.listPlans({ force: hasCachedPlans })'))
    expect(benefitsPage.indexOf('mipCommerceModule.peekMembershipBenefits()'))
      .toBeLessThan(benefitsPage.indexOf('Promise.allSettled(['))
    expect(benefitsPage).toContain('mipCommerceModule.listPlans({ force: cachedPlans !== undefined })')
    expect(membershipPage).toContain('this.applyPlans(cached, false)')
    expect(membershipPage).toContain('this.applyPlans(plans, true)')
    expect(membershipView).toContain('!plansVerified')
  })

  it('hydrates a recent server plan catalog and rejects expired local data', () => {
    let stored: unknown = {
      version: 1,
      catalogStage: 'TEST',
      cachedAt: 900,
      plans: [plan],
    }
    const storage = {
      read: vi.fn(() => stored),
      write: vi.fn((value) => { stored = value }),
      clear: vi.fn(() => { stored = undefined }),
    }
    const cache = createMembershipPlanCache({
      catalogStage: 'TEST',
      storage,
      now: () => 1_000,
      maxStaleMs: 200,
    })
    expect(cache.peek()).toEqual([plan])

    const expired = createMembershipPlanCache({
      catalogStage: 'TEST',
      storage: {
        ...storage,
        read: () => ({ version: 1, catalogStage: 'TEST', cachedAt: 700, plans: [plan] }),
      },
      now: () => 1_000,
      maxStaleMs: 200,
    })
    expect(expired.peek()).toBeUndefined()
    expect(storage.clear).toHaveBeenCalled()
  })

  it('shows cached plans without transport and refreshes them only when requested', async () => {
    const cachedPlan = { ...plan, version: 1 }
    const refreshedPlan = { ...plan, name: '更新后的一年会员', version: 2 }
    let stored: unknown = {
      version: 1,
      catalogStage: 'TEST',
      cachedAt: 1_000,
      plans: [cachedPlan],
    }
    const planCache = createMembershipPlanCache({
      catalogStage: 'TEST',
      storage: {
        read: () => stored,
        write: (value) => { stored = value },
        clear: () => { stored = undefined },
      },
      now: () => 1_100,
    })
    const readPlans = vi.fn(async () => [refreshedPlan])
    const module = createMipCommerceModule(gateway({ listPlans: readPlans }), payment, {
      paymentMode: 'disabled',
      catalogStage: 'TEST',
      planCache,
    })

    expect(module.peekPlans()).toEqual([cachedPlan])
    await expect(module.listPlans()).resolves.toEqual([cachedPlan])
    expect(readPlans).not.toHaveBeenCalled()
    await expect(module.listPlans({ force: true })).resolves.toEqual([refreshedPlan])
    expect(module.peekPlans()).toEqual([refreshedPlan])
    expect(readPlans).toHaveBeenCalledTimes(1)
  })

  it('deduplicates membership reads and drops user facts at the session boundary', async () => {
    let resolveRead: ((value: MembershipBenefitsSnapshot) => void) | undefined
    const readBenefits = vi.fn(() => new Promise<MembershipBenefitsSnapshot>((resolve) => {
      resolveRead = resolve
    }))
    const module = createMipCommerceModule(gateway({ getMembershipBenefits: readBenefits }), payment, {
      paymentMode: 'disabled',
      catalogStage: 'TEST',
    })

    const first = module.getMembershipBenefits()
    const second = module.getMembershipBenefits({ force: true })
    expect(readBenefits).toHaveBeenCalledTimes(1)
    resolveRead?.(guest)
    await expect(Promise.all([first, second])).resolves.toEqual([guest, guest])
    expect(module.peekMembershipBenefits()).toEqual(guest)
    await module.getMembershipBenefits({ force: false })
    expect(readBenefits).toHaveBeenCalledTimes(1)

    const refreshedRead = module.getMembershipBenefits()
    expect(readBenefits).toHaveBeenCalledTimes(2)
    resolveRead?.(guest)
    await refreshedRead

    module.clearUserCache()
    expect(module.peekMembershipBenefits()).toBeUndefined()
  })
})
