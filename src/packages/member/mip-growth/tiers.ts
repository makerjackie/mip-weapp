import type { GrowthLevel, GrowthLevelBenefit } from '../../../modules/mip-growth'

/**
 * MIW-83 GROWTH-01：等级权益差异档位视图。
 * 档位是前端纯派生——快照 levels（minimumExperience 升序）中「权益名列表完全相同」的
 * 相邻等级合并为一档，档位标签取该档首个等级号（L1 起，无 L0）。
 */
export interface GrowthTierView {
  /** 档首等级号（1-based，直接用于 Lv.N 标签）。 */
  levelNumber: number
  /** 该档首个等级在 snapshot.levels 中的下标，权益区取 levels[startIndex].benefits。 */
  startIndex: number
  /** 非会员全部锁定；会员锁定 = 档首等级号 > 当前等级号。 */
  locked: boolean
}

/** MIW-83 GROWTH-02：权益网格槽位——具名权益 + 「脑暴中...」占位补齐 4 的倍数。 */
export interface GrowthBenefitSlotView {
  key: string
  name: string
  /** 空说明的点按不弹详情。 */
  description: string
  pending: boolean
}

export const GROWTH_BENEFIT_GRID_COLUMNS = 4

const PENDING_BENEFIT_LABEL = '脑暴中...'
const TIER_BENEFIT_KEY_SEPARATOR = '\u0001'

export function deriveTierStartIndexes(levels: readonly GrowthLevel[]): number[] {
  const starts: number[] = []
  let previousKey: string | null = null
  levels.forEach((level, index) => {
    const key = level.benefits.map(benefit => benefit.name).join(TIER_BENEFIT_KEY_SEPARATOR)
    if (previousKey === null || key !== previousKey) {
      starts.push(index)
      previousKey = key
    }
  })
  return starts
}

export function tierViews(
  tierStartIndexes: readonly number[],
  currentLevelNumber: number,
  isPlayer: boolean,
): GrowthTierView[] {
  return tierStartIndexes.map(startIndex => ({
    levelNumber: startIndex + 1,
    startIndex,
    locked: !isPlayer || startIndex + 1 > currentLevelNumber,
  }))
}

/** 会员默认选中「包含当前等级」的档位；非会员（全部锁定）落在 L1 起始档。 */
export function selectedTierIndexFor(tiers: readonly GrowthTierView[], currentLevelNumber: number): number {
  let selected = 0
  tiers.forEach((tier, index) => {
    if (tier.levelNumber <= currentLevelNumber) {
      selected = index
    }
  })
  return selected
}

export function benefitSlots(benefits: readonly GrowthLevelBenefit[]): GrowthBenefitSlotView[] {
  const slots = benefits.map((benefit, index) => ({
    key: `benefit-${index}`,
    name: benefit.name,
    description: benefit.description || '',
    pending: false,
  }))
  // 设计稿（figma 3984:8403）：2 项具名权益时以「脑暴中...」橄榄圆补足 4 槽。
  const paddedLength = Math.max(
    GROWTH_BENEFIT_GRID_COLUMNS,
    Math.ceil(slots.length / GROWTH_BENEFIT_GRID_COLUMNS) * GROWTH_BENEFIT_GRID_COLUMNS,
  )
  for (let index = slots.length; index < paddedLength; index += 1) {
    slots.push({ key: `pending-${index}`, name: PENDING_BENEFIT_LABEL, description: '', pending: true })
  }
  return slots
}

/**
 * 权益面板最小高度（rpx）：1 行 238（figma 3984:8075 面板 119px），
 * 每加一行 +154（图圈 80 + 名称 34 + 行距 40）。min-height 参与 .28s 高度过渡。
 */
export function benefitPanelMinHeight(slotCount: number): number {
  const rows = Math.max(1, Math.ceil(slotCount / GROWTH_BENEFIT_GRID_COLUMNS))
  return 238 + (rows - 1) * 154
}
