import type { UserId } from '../src/modules/mip'
import type { GrowthAccount, GrowthLevel, GrowthRule } from '../src/modules/mip-growth'
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  applyGrowthProjection,
  buildGrowthSnapshot,
  projectGrowthEntry,
  resolveGrowthLevel,
} from '../src/modules/mip-growth'

const levels: GrowthLevel[] = [
  { id: 'level-1' as never, levelKey: 'starter', name: '一级', minimumExperience: 0, benefits: [], status: 'ACTIVE' },
  { id: 'level-2' as never, levelKey: 'regular', name: '二级', minimumExperience: 100, benefits: [], status: 'ACTIVE' },
]
const account: GrowthAccount = {
  userId: 'user-1' as UserId,
  experienceBalance: 90,
  contributionBalance: 10,
  coinBalance: 3,
  version: 2,
}

function rule(overrides: Partial<GrowthRule> = {}): GrowthRule {
  return {
    id: 'rule-1' as never,
    ruleKey: 'event-check-in',
    name: '活动签到',
    metric: 'EXPERIENCE',
    deltaValue: 20,
    dailyLimitValue: 30,
    sourceEventType: 'event.checked_in',
    status: 'ACTIVE',
    ...overrides,
  }
}

describe('MIP growth', () => {
  it('resolves only configured active level thresholds', () => {
    expect(resolveGrowthLevel(levels, 99).levelKey).toBe('starter')
    expect(resolveGrowthLevel(levels, 100).levelKey).toBe('regular')
    expect(() => resolveGrowthLevel(levels.slice(1), 100)).toThrow('GROWTH_LEVEL_BASE_REQUIRED')
  })

  it('caps a positive reward at the server daily limit', () => {
    const projection = projectGrowthEntry(account, rule(), 25)
    expect(projection).toEqual({
      metric: 'EXPERIENCE',
      requestedDelta: 20,
      appliedDelta: 5,
      balanceAfter: 95,
      capped: true,
    })
    expect(applyGrowthProjection(account, projection)).toMatchObject({
      experienceBalance: 95,
      version: 3,
    })
  })

  it('rejects adjustments that would create a negative balance', () => {
    expect(() => projectGrowthEntry(account, rule({ deltaValue: -100 }), 0))
      .toThrow('GROWTH_BALANCE_INVALID')
  })

  it('projects progress without letting the page derive a different level', () => {
    expect(buildGrowthSnapshot(account, levels)).toMatchObject({
      currentLevel: { levelKey: 'starter' },
      nextLevel: { levelKey: 'regular' },
      experienceToNextLevel: 10,
      levelProgressPercent: 90,
    })
  })

  it('keeps the admin editor limited to server-approved reward values', () => {
    const page = fs.readFileSync(path.join(process.cwd(), 'src/packages/admin/growth-rules/index.wxml'), 'utf8')
    const controller = fs.readFileSync(path.join(process.cwd(), 'src/packages/admin/growth-rules/index.ts'), 'utf8')
    expect(page).not.toContain('新增规则')
    expect(page).not.toContain('data-field="ruleKey"')
    expect(page).not.toContain('data-field="metric"')
    expect(page).not.toContain('data-field="sourceEventType"')
    expect(controller).toContain('!this.data.editorId')
  })
})
