import type { CooperationRoleKey } from '../src/modules/mip'
import { describe, expect, it } from 'vitest'
import {
  cooperationAbilityDimensions,
  cooperationRoles,
} from '../src/config/mip-catalogs'
import {
  normalizeCooperationCardDraft,
  normalizeCooperationCardFilter,
  normalizeCooperationCircles,
  normalizeCooperationQuirks,
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

  it('maps six per-role trait labels onto the stable ability storage keys', () => {
    expect(cooperationRoles.map(role => role.abilityLabels)).toEqual([
      ['开拓人脉', '引荐人脉', '长期维护', '引荐商机', '卖点提炼', '跨圈交际'],
      ['商机洞察', '财务测算', '盈利建模', '资源整合', '利益统筹', '合作谈判'],
      ['投资洞察', '上市规划', '股权规划', '投融策划', '融资达成', '资源整合'],
      ['项目调研', '项目定位', '创新创意', '方法设计', '提案竞标', '落地规划'],
      ['视觉策略', '视觉设计', '素材搜寻', '视觉落地', '视觉管理', '提案竞标'],
      ['目标计划', '执行统筹', '进度复盘', '沟通机制', '标准研发', '应急沟通'],
    ])
    expect(cooperationAbilityDimensions.map(dimension => dimension.key)).toEqual([
      'business_development',
      'resource_integration',
      'capital_operation',
      'strategy_planning',
      'visual_design',
      'delivery_management',
    ])
  })

  it('normalizes structured circles and accepts legacy name-only string arrays', () => {
    expect(normalizeCooperationCircles([
      { name: 'MIP全球创意人平台', identity: '资深玩家', years: '2年', trait: '超级个体' },
      '创业者社群',
      { trait: '只有特点没有名称' },
      '',
      {},
    ])).toEqual([
      { name: 'MIP全球创意人平台', identity: '资深玩家', years: '2年', trait: '超级个体' },
      { name: '创业者社群' },
      { trait: '只有特点没有名称' },
    ])
    expect(normalizeCooperationCircles(undefined)).toBeUndefined()
    expect(normalizeCooperationCircles(Array.from({ length: 20 }, (_, index) => `圈子${index}`)))
      .toHaveLength(12)
  })

  it('normalizes structured quirk groups and drops empty entries', () => {
    expect(normalizeCooperationQuirks([
      { external: '拖延症晚期', internal: '存在侥幸心理', advice: '请跟我强调事情的紧迫性' },
      { external: '只有外显' },
      '不是对象',
      {},
    ])).toEqual([
      { external: '拖延症晚期', internal: '存在侥幸心理', advice: '请跟我强调事情的紧迫性' },
      { external: '只有外显' },
    ])
  })

  it('keeps common fields, structured groups and legacy keys while dropping unknown keys', () => {
    const normalized = normalizeCooperationCardDraft({
      roleKey: 'strategist',
      positioning: '为项目确定方向',
      targetSummary: '26年接3个非标商业项目',
      roleFields: {
        support: '需要能带队打仗的操盘手',
        value: '和我合作，能打胜仗',
        planning_types: ['品牌策划', '活动策划'],
        quirks: [{ external: '拖延症晚期', internal: '存在侥幸心理', advice: '强调紧迫性' }],
        methods: '用户研究',
        target: '三个项目',
        ignored: '不应保存',
      },
      abilityScores: {},
      publish: false,
    })
    expect(normalized.roleFields).toEqual({
      support: '需要能带队打仗的操盘手',
      value: '和我合作，能打胜仗',
      planning_types: ['品牌策划', '活动策划'],
      quirks: [{ external: '拖延症晚期', internal: '存在侥幸心理', advice: '强调紧迫性' }],
      methods: '用户研究',
      target: '三个项目',
    })

    const connector = normalizeCooperationCardDraft({
      roleKey: 'connector',
      positioning: '愿意分享自己的人脉或为他人引荐生意',
      targetSummary: '2026 年商务引荐赚100 万',
      roleFields: { circles: [{ name: 'MIP全球创意人平台', identity: '资深玩家' }] },
      abilityScores: {},
      publish: false,
    })
    expect(Object.keys(connector.roleFields)).toEqual(['circles'])
    expect(normalizeCooperationCardDraft({
      roleKey: 'connector',
      positioning: '愿意分享自己的人脉或为他人引荐生意',
      targetSummary: '目标',
      roleFields: { methods: '非该角色字段' },
      abilityScores: {},
      publish: false,
    }).roleFields).toEqual({})
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
    const abilityId = '22000000-0000-4000-8000-000000000001'
    expect(normalizeCooperationCardFilter({
      keyword: '  品牌合作  ',
      branchId,
      roleKey: 'strategist',
      industryTagIds: [industryId, industryId],
      abilityTagIds: [abilityId, abilityId],
      cursor: '  cursor-value  ',
      limit: 100,
    })).toEqual({
      keyword: '品牌合作',
      branchId,
      roleKey: 'strategist',
      industryTagIds: [industryId],
      abilityTagIds: [abilityId],
      cursor: 'cursor-value',
      limit: 30,
    })
    expect(normalizeCooperationCardFilter({
      roleKey: 'admin' as CooperationRoleKey,
    }).roleKey).toBeUndefined()
    expect(() => normalizeCooperationCardFilter({
      industryTagIds: ['not-a-uuid'],
    })).toThrow('行业标签格式不正确')
    // MIW-31：能力标签与行业同口径校验（UUID + 最多 8 项）。
    expect(() => normalizeCooperationCardFilter({
      abilityTagIds: ['not-a-uuid'],
    })).toThrow('能力标签格式不正确')
    expect(() => normalizeCooperationCardFilter({
      abilityTagIds: Array.from({ length: 9 }, (_, index) => `22000000-0000-4000-8000-00000000000${index}`),
    })).toThrow('能力标签格式不正确')
  })
})
