import type { MipAdminGateway } from './types'

interface GrowthAdminCache {
  query: <T>(key: string, loader: () => Promise<T>, options?: { force?: boolean }) => Promise<T>
  invalidate: (prefix?: string) => void
}

type GrowthEntryListInput = NonNullable<Parameters<MipAdminGateway['listGrowthEntries']>[0]>
type GrowthTransitionListInput = NonNullable<Parameters<MipAdminGateway['listGrowthLevelTransitions']>[0]>
type BadgeAwardListInput = NonNullable<Parameters<MipAdminGateway['listBadgeAwards']>[0]>

export interface MipGrowthAdmin {
  listLevels: (force?: boolean) => ReturnType<MipAdminGateway['listGrowthLevels']>
  listBenefits: (force?: boolean) => ReturnType<MipAdminGateway['listGrowthBenefits']>
  listRules: (force?: boolean) => ReturnType<MipAdminGateway['listGrowthRules']>
  listEntries: (
    input?: GrowthEntryListInput,
    force?: boolean,
  ) => ReturnType<MipAdminGateway['listGrowthEntries']>
  listLevelTransitions: (
    input?: GrowthTransitionListInput,
    force?: boolean,
  ) => ReturnType<MipAdminGateway['listGrowthLevelTransitions']>
  listBadges: (force?: boolean) => ReturnType<MipAdminGateway['listBadges']>
  listBadgeAwards: (
    input?: BadgeAwardListInput,
    force?: boolean,
  ) => ReturnType<MipAdminGateway['listBadgeAwards']>
  adjust: MipAdminGateway['adjustGrowth']
  saveLevel: MipAdminGateway['saveGrowthLevel']
  saveBenefit: MipAdminGateway['saveGrowthBenefit']
  saveRule: MipAdminGateway['saveGrowthRule']
  saveBadge: MipAdminGateway['saveBadge']
  grantBadge: MipAdminGateway['grantBadge']
  revokeBadge: MipAdminGateway['revokeBadge']
}

const cacheKeys = {
  levels: 'mip-admin:growth-levels',
  benefits: 'mip-admin:growth-benefits',
  rules: 'mip-admin:growth-rules',
  entries: 'mip-admin:growth-entries',
  transitions: 'mip-admin:growth-level-transitions',
  badges: 'mip-admin:badges',
  badgeAwards: 'mip-admin:badge-awards',
} as const

export function createMipGrowthAdmin(
  gateway: MipAdminGateway,
  cache: GrowthAdminCache,
): MipGrowthAdmin {
  const mutate = async <T>(prefixes: string[], work: () => Promise<T>) => {
    const result = await work()
    for (const prefix of prefixes) {
      cache.invalidate(prefix)
    }
    return result
  }

  return {
    listLevels: (force = false) => cache.query(cacheKeys.levels, gateway.listGrowthLevels, { force }),
    listBenefits: (force = false) => cache.query(cacheKeys.benefits, gateway.listGrowthBenefits, { force }),
    listRules: (force = false) => cache.query(cacheKeys.rules, gateway.listGrowthRules, { force }),
    listEntries: (input: GrowthEntryListInput = {}, force = false) => cache.query(
      `${cacheKeys.entries}:${JSON.stringify(input)}`,
      () => gateway.listGrowthEntries(input),
      { force },
    ),
    listLevelTransitions: (input: GrowthTransitionListInput = {}, force = false) => cache.query(
      `${cacheKeys.transitions}:${JSON.stringify(input)}`,
      () => gateway.listGrowthLevelTransitions(input),
      { force },
    ),
    listBadges: (force = false) => cache.query(cacheKeys.badges, gateway.listBadges, { force }),
    listBadgeAwards: (input: BadgeAwardListInput = {}, force = false) => cache.query(
      `${cacheKeys.badgeAwards}:${JSON.stringify(input)}`,
      () => gateway.listBadgeAwards(input),
      { force },
    ),
    adjust: input => mutate([cacheKeys.entries], () => gateway.adjustGrowth(input)),
    saveLevel: input => mutate([cacheKeys.levels], () => gateway.saveGrowthLevel(input)),
    saveBenefit: input => mutate(
      [cacheKeys.benefits, cacheKeys.levels],
      () => gateway.saveGrowthBenefit(input),
    ),
    saveRule: input => mutate([cacheKeys.rules], () => gateway.saveGrowthRule(input)),
    saveBadge: input => mutate(
      [cacheKeys.badges, cacheKeys.badgeAwards],
      () => gateway.saveBadge(input),
    ),
    grantBadge: input => mutate([cacheKeys.badgeAwards], () => gateway.grantBadge(input)),
    revokeBadge: input => mutate([cacheKeys.badgeAwards], () => gateway.revokeBadge(input)),
  }
}
