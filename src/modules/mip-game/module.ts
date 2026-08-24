import type { MipGameGateway } from './types'

export function createMipGameModule(gateway: MipGameGateway) {
  return {
    gateway,
    rankingLabels: {
      TEAM_HALF_YEAR: '团队半年榜',
      TEAM_YEAR: '团队年度榜',
      INDIVIDUAL_SEASON: '个人赛季榜',
      INDIVIDUAL_ALL_TIME: '个人累计榜',
    } as const,
  }
}
