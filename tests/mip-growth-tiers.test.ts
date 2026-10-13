import type { GrowthLevel } from '../src/modules/mip-growth'
import { describe, expect, it } from 'vitest'
import {
  benefitPanelMinHeight,
  benefitSlots,
  deriveTierStartIndexes,
  selectedTierIndexFor,
  tierViews,
} from '../src/packages/member/mip-growth/tiers'

// MIW-83 GROWTH-01/02：档位是前端纯派生——相邻等级权益名列表完全相同才并档，
// 档位标签取段首等级号；权益区跟随档位并按 4 列补「脑暴中...」占位。

function level(levelKey: string, minimumExperience: number, benefitNames: string[]): GrowthLevel {
  return {
    id: levelKey as GrowthLevel['id'],
    levelKey,
    name: levelKey,
    minimumExperience,
    benefits: benefitNames.map(name => ({ name })),
    status: 'ACTIVE',
  }
}

/** figma 3984:8958 / 原型 12 档形态：档首 L1/L3/L5/.../L60。 */
function ladderFixture() {
  return [
    level('L1', 0, ['早会报名', '玩家社群', '内部活动', '新手任务']),
    level('L2', 50, ['早会报名', '玩家社群', '内部活动', '新手任务']),
    level('L3', 100, ['报名参与副本', '认领1星NPC']),
    level('L4', 150, ['报名参与副本', '认领1星NPC']),
    level('L5', 200, ['报名参与副本', '认领1星NPC', '优先报名权']),
    level('L6', 300, ['报名参与副本', '认领1星NPC', '优先报名权']),
  ]
}

describe('growth benefit tier derivation', () => {
  it('merges adjacent levels sharing the same benefit names and keeps the first level number', () => {
    const levels = ladderFixture()
    const starts = deriveTierStartIndexes(levels)
    expect(starts).toEqual([0, 2, 4])

    const memberTiers = tierViews(starts, 4, true)
    expect(memberTiers).toEqual([
      { levelNumber: 1, startIndex: 0, locked: false },
      { levelNumber: 3, startIndex: 2, locked: false },
      { levelNumber: 5, startIndex: 4, locked: true },
    ])
    // 会员默认落在「包含当前等级」的档位（Lv.2 玩家 → Lv.1 档）。
    expect(selectedTierIndexFor(memberTiers, 2)).toBe(0)
    expect(selectedTierIndexFor(memberTiers, 4)).toBe(1)
  })

  it('locks every tier for non-members and defaults the selection to the first tier', () => {
    const levels = ladderFixture()
    const tiers = tierViews(deriveTierStartIndexes(levels), 1, false)
    expect(tiers.every(tier => tier.locked)).toBe(true)
    expect(selectedTierIndexFor(tiers, 1)).toBe(0)
  })

  it('still derives one tier for a single-level snapshot', () => {
    const levels = [level('L1', 0, ['新手任务'])]
    const tiers = tierViews(deriveTierStartIndexes(levels), 1, true)
    expect(tiers).toEqual([{ levelNumber: 1, startIndex: 0, locked: false }])
  })

  it('derives every tier of a twelve-tier ladder from merged level runs', () => {
    // 等级号 = 快照位置（index+1），档位标签取档首位置：12 档 × 每档 2 级。
    const tierHeads = [1, 3, 5, 7, 9, 11, 13, 15, 17, 19, 21, 23]
    const levels = tierHeads.flatMap((head, index) => {
      const benefits = index % 2 === 0 ? ['权益甲'] : ['权益甲', '权益乙']
      return [
        level(`L${head}`, head * 100, benefits),
        level(`L${head + 1}`, (head + 1) * 100, benefits),
      ]
    })
    const starts = deriveTierStartIndexes(levels)
    expect(starts).toEqual([0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22])
    expect(tierViews(starts, 24, true).map(tier => tier.levelNumber)).toEqual(tierHeads)
  })

  it('does not merge adjacent levels when only benefit order differs', () => {
    const levels = [
      level('L1', 0, ['甲', '乙']),
      level('L2', 50, ['乙', '甲']),
    ]
    expect(deriveTierStartIndexes(levels)).toEqual([0, 1])
  })
})

describe('growth benefit slots', () => {
  it('pads the grid to four slots with brainstorm placeholders', () => {
    const slots = benefitSlots([{ name: '报名参与副本' }, { name: '认领1星NPC' }])
    expect(slots).toEqual([
      { key: 'benefit-0', name: '报名参与副本', description: '', pending: false },
      { key: 'benefit-1', name: '认领1星NPC', description: '', pending: false },
      { key: 'pending-2', name: '脑暴中...', description: '', pending: true },
      { key: 'pending-3', name: '脑暴中...', description: '', pending: true },
    ])
  })

  it('keeps benefit descriptions and pads multiples of four beyond one row', () => {
    const slots = benefitSlots([
      { name: '甲', description: '甲说明' },
      { name: '乙' },
      { name: '丙', description: '' },
      { name: '丁' },
      { name: '戊' },
    ])
    expect(slots).toHaveLength(8)
    expect(slots[0]).toEqual({ key: 'benefit-0', name: '甲', description: '甲说明', pending: false })
    expect(slots[2].description).toBe('')
    expect(slots.slice(5).every(slot => slot.pending)).toBe(true)
  })

  it('renders four brainstorm placeholders when a tier has no benefits yet', () => {
    const slots = benefitSlots([])
    expect(slots).toHaveLength(4)
    expect(slots.every(slot => slot.pending && slot.name === '脑暴中...')).toBe(true)
  })

  it('scales the panel min-height one row step per four slots', () => {
    expect(benefitPanelMinHeight(4)).toBe(238)
    expect(benefitPanelMinHeight(8)).toBe(392)
    expect(benefitPanelMinHeight(12)).toBe(546)
  })
})
