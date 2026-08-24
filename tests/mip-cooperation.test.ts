import type { CooperationRoleKey } from '../src/modules/mip'
import { describe, expect, it } from 'vitest'
import { cooperationAbilityDimensions, cooperationRoles } from '../src/config/mip-catalogs'
import {
  normalizeCooperationCardDraft,
  normalizeCooperationCardFilter,
} from '../src/modules/mip-cooperation/validation'

describe('MIP cooperation card contracts', () => {
  it('keeps the six confirmed role keys and display names', () => {
    expect(cooperationRoles.map(role => [role.key, role.name])).toEqual([
      ['connector', '皮条客'],
      ['business_builder', '生意佬'],
      ['capital_operator', '暴发户'],
      ['strategist', '狗策划'],
      ['visual_designer', '死美工'],
      ['delivery_lead', '老保姆'],
    ])
  })

  it('retains only role-specific fields and all six bounded ability scores', () => {
    const normalized = normalizeCooperationCardDraft({
      roleKey: 'connector',
      positioning: '连接客户和合作资源',
      targetSummary: '今年完成十次有效引荐',
      roleFields: {
        circles: ['品牌', '零售'],
        resources: '消费品牌渠道',
        target: '促成三次合作',
        ignored: '不应保存',
      },
      abilityScores: Object.fromEntries(cooperationAbilityDimensions.map((item, index) => [item.key, index + 1])),
      publish: true,
    })
    expect(Object.keys(normalized.roleFields)).toEqual(['circles', 'resources', 'target'])
    expect(Object.keys(normalized.abilityScores)).toHaveLength(6)
    expect(Math.max(...Object.values(normalized.abilityScores))).toBe(5)
  })

  it('rejects an unknown cooperation role', () => {
    expect(() => normalizeCooperationCardDraft({
      roleKey: 'admin' as CooperationRoleKey,
      positioning: '无效',
      targetSummary: '无效',
      roleFields: {},
      abilityScores: {},
      publish: false,
    })).toThrow('请选择合作角色')
  })

  it('normalizes cooperation discovery filters before transport', () => {
    const branchId = '10000000-0000-4000-8000-000000000001'
    const industryId = '20000000-0000-4000-8000-000000000001'
    expect(normalizeCooperationCardFilter({
      keyword: '  品牌合作  ',
      branchId,
      roleKey: 'strategist',
      industryTagIds: [industryId, industryId],
      cursor: '  cursor-value  ',
      limit: 100,
    })).toEqual({
      keyword: '品牌合作',
      branchId,
      roleKey: 'strategist',
      industryTagIds: [industryId],
      cursor: 'cursor-value',
      limit: 30,
    })
    expect(normalizeCooperationCardFilter({
      roleKey: 'admin' as CooperationRoleKey,
    }).roleKey).toBeUndefined()
    expect(() => normalizeCooperationCardFilter({
      industryTagIds: ['not-a-uuid'],
    })).toThrow('行业标签格式不正确')
  })
})
