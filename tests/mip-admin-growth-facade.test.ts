import type { MipGrowthAdmin } from '../src/modules/mip-admin/growth-admin'
import type { MipAdminGateway } from '../src/modules/mip-admin/types'
import { describe, expect, it, vi } from 'vitest'
import { createMipAdminModule } from '../src/modules/mip-admin/client'
import { MipAdminError } from '../src/modules/mip-admin/types'

function createHarness() {
  const spies = {
    listGrowthLevels: vi.fn<MipAdminGateway['listGrowthLevels']>(async () => ({ items: [], nextCursor: null })),
    listGrowthBenefits: vi.fn<MipAdminGateway['listGrowthBenefits']>(async () => ({ items: [], nextCursor: null })),
    listGrowthRules: vi.fn<MipAdminGateway['listGrowthRules']>(async () => ({ items: [], nextCursor: null })),
    listGrowthEntries: vi.fn<MipAdminGateway['listGrowthEntries']>(async () => ({ items: [], nextCursor: null })),
    listBadges: vi.fn<MipAdminGateway['listBadges']>(async () => ({ items: [], nextCursor: null })),
    listBadgeAwards: vi.fn<MipAdminGateway['listBadgeAwards']>(async () => ({ items: [], nextCursor: null })),
    adjustGrowth: vi.fn<MipAdminGateway['adjustGrowth']>(async () => ({ id: 'entry-a' })),
    saveGrowthLevel: vi.fn<MipAdminGateway['saveGrowthLevel']>(async () => ({ id: 'level-a', version: 2 })),
    saveGrowthBenefit: vi.fn<MipAdminGateway['saveGrowthBenefit']>(async () => ({ id: 'benefit-a', version: 2 })),
    saveGrowthRule: vi.fn<MipAdminGateway['saveGrowthRule']>(async () => ({ id: 'rule-a', version: 2 })),
    saveBadge: vi.fn<MipAdminGateway['saveBadge']>(async () => ({ id: 'badge-a', version: 2 })),
    grantBadge: vi.fn<MipAdminGateway['grantBadge']>(async () => ({ id: 'award-a' })),
    revokeBadge: vi.fn<MipAdminGateway['revokeBadge']>(async () => ({ id: 'award-a', status: 'REVOKED' })),
  }
  const gateway = spies as unknown as MipAdminGateway
  return { module: createMipAdminModule(gateway), spies }
}

const adjustInput = {
  userId: 'user-a',
  metric: 'EXPERIENCE',
  deltaValue: 20,
  reason: '线下活动补录',
  idempotencyKey: 'growth-adjust-a',
}
const saveLevelInput = {
  levelId: 'level-a',
  expectedVersion: 1,
  draft: { levelKey: 'starter', name: '一级', benefitIds: ['benefit-a'] },
}
const saveBenefitInput = {
  benefitId: 'benefit-a',
  expectedVersion: 1,
  draft: { name: '活动优先报名', status: 'ACTIVE' },
}
const saveRuleInput = {
  ruleId: 'rule-a',
  expectedVersion: 1,
  draft: { ruleKey: 'event-check-in', deltaValue: 10 },
}
const saveBadgeInput = {
  badgeId: 'badge-a',
  expectedVersion: 1,
  draft: { key: 'event_participant', name: '活动参与', status: 'ACTIVE' },
}
const grantBadgeInput = { userId: 'user-a', badgeId: 'badge-a', reason: '完成活动参与' }
const revokeBadgeInput = { awardId: 'award-a', expectedVersion: 1, reason: '授予记录有误' }

type QuerySpyName
  = | 'listGrowthLevels'
    | 'listGrowthBenefits'
    | 'listGrowthRules'
    | 'listGrowthEntries'
    | 'listBadges'
    | 'listBadgeAwards'

interface MutationCase {
  name: string
  execute: (growth: MipGrowthAdmin) => Promise<unknown>
  invalidated: QuerySpyName[]
}

function mutationCases(): MutationCase[] {
  return [
    { name: 'adjust', execute: growth => growth.adjust(adjustInput), invalidated: ['listGrowthEntries'] },
    { name: 'saveLevel', execute: growth => growth.saveLevel(saveLevelInput), invalidated: ['listGrowthLevels'] },
    {
      name: 'saveBenefit',
      execute: growth => growth.saveBenefit(saveBenefitInput),
      invalidated: ['listGrowthBenefits', 'listGrowthLevels'],
    },
    { name: 'saveRule', execute: growth => growth.saveRule(saveRuleInput), invalidated: ['listGrowthRules'] },
    {
      name: 'saveBadge',
      execute: growth => growth.saveBadge(saveBadgeInput),
      invalidated: ['listBadges', 'listBadgeAwards'],
    },
    { name: 'grantBadge', execute: growth => growth.grantBadge(grantBadgeInput), invalidated: ['listBadgeAwards'] },
    { name: 'revokeBadge', execute: growth => growth.revokeBadge(revokeBadgeInput), invalidated: ['listBadgeAwards'] },
  ]
}

const querySpies: QuerySpyName[] = [
  'listGrowthLevels',
  'listGrowthBenefits',
  'listGrowthRules',
  'listGrowthEntries',
  'listBadges',
  'listBadgeAwards',
]

async function warmGrowthQueries(growth: MipGrowthAdmin) {
  await Promise.all([
    growth.listLevels(),
    growth.listBenefits(),
    growth.listRules(),
    growth.listEntries({ filters: { metric: 'EXPERIENCE' } }),
    growth.listBadges(),
    growth.listBadgeAwards({ query: '活动', status: 'ACTIVE' }),
  ])
}

describe('MIP admin growth facade', () => {
  it('keeps query inputs and results behind the typed facade', async () => {
    const { module, spies } = createHarness()
    const entryInput = { filters: { metric: 'CONTRIBUTION' }, cursor: 'cursor-a' }
    const awardInput = { query: '活动', status: 'ACTIVE' as const }

    await expect(module.growth.listLevels()).resolves.toEqual({ items: [], nextCursor: null })
    await expect(module.growth.listBenefits()).resolves.toEqual({ items: [], nextCursor: null })
    await expect(module.growth.listRules()).resolves.toEqual({ items: [], nextCursor: null })
    await expect(module.growth.listEntries(entryInput)).resolves.toEqual({ items: [], nextCursor: null })
    await expect(module.growth.listBadges()).resolves.toEqual({ items: [], nextCursor: null })
    await expect(module.growth.listBadgeAwards(awardInput)).resolves.toEqual({ items: [], nextCursor: null })

    expect(spies.listGrowthEntries).toHaveBeenCalledWith(entryInput)
    expect(spies.listBadgeAwards).toHaveBeenCalledWith(awardInput)
  })

  it('keeps legacy query aliases on the same cache for remaining callers', async () => {
    const { module, spies } = createHarness()

    await module.growth.listLevels()
    await module.growth.listLevels()
    await module.growth.listBadgeAwards({ status: 'ACTIVE' })
    await module.growth.listBadgeAwards({ status: 'ACTIVE' })

    expect(spies.listGrowthLevels).toHaveBeenCalledTimes(1)
    expect(spies.listBadgeAwards).toHaveBeenCalledTimes(1)
  })

  it('passes every mutation input to the neutral gateway unchanged', async () => {
    const { module, spies } = createHarness()

    await module.growth.adjust(adjustInput)
    await module.growth.saveLevel(saveLevelInput)
    await module.growth.saveBenefit(saveBenefitInput)
    await module.growth.saveRule(saveRuleInput)
    await module.growth.saveBadge(saveBadgeInput)
    await module.growth.grantBadge(grantBadgeInput)
    await module.growth.revokeBadge(revokeBadgeInput)

    expect(spies.adjustGrowth.mock.calls[0]?.[0]).toBe(adjustInput)
    expect(spies.saveGrowthLevel.mock.calls[0]?.[0]).toBe(saveLevelInput)
    expect(spies.saveGrowthBenefit.mock.calls[0]?.[0]).toBe(saveBenefitInput)
    expect(spies.saveGrowthRule.mock.calls[0]?.[0]).toBe(saveRuleInput)
    expect(spies.saveBadge.mock.calls[0]?.[0]).toBe(saveBadgeInput)
    expect(spies.grantBadge.mock.calls[0]?.[0]).toBe(grantBadgeInput)
    expect(spies.revokeBadge.mock.calls[0]?.[0]).toBe(revokeBadgeInput)
  })

  for (const mutation of mutationCases()) {
    it(`invalidates only dependent caches after ${mutation.name}`, async () => {
      const { module, spies } = createHarness()
      await warmGrowthQueries(module.growth)
      await warmGrowthQueries(module.growth)

      await mutation.execute(module.growth)
      await warmGrowthQueries(module.growth)

      for (const query of querySpies) {
        expect(spies[query]).toHaveBeenCalledTimes(mutation.invalidated.includes(query) ? 2 : 1)
      }
    })
  }

  it('preserves failed mutations without clearing successful cached reads', async () => {
    const { module, spies } = createHarness()
    const conflict = new MipAdminError('CONFLICT', '成长等级已被其他管理员更新')
    spies.saveGrowthLevel.mockRejectedValueOnce(conflict)
    await warmGrowthQueries(module.growth)

    await expect(module.growth.saveLevel(saveLevelInput)).rejects.toBe(conflict)
    await warmGrowthQueries(module.growth)

    for (const query of querySpies) {
      expect(spies[query]).toHaveBeenCalledTimes(1)
    }
  })

  it('passes permission failures through to page state without replacement', async () => {
    const { module, spies } = createHarness()
    const forbidden = new MipAdminError('FORBIDDEN', '当前账号不能授予勋章')
    spies.grantBadge.mockRejectedValueOnce(forbidden)

    const error = await module.growth.grantBadge(grantBadgeInput).catch(caught => caught)
    expect(error).toBe(forbidden)
  })
})
