import { describe, expect, it } from 'vitest'
import { opportunityValueHintFromText, parseOpportunityText } from '../src/modules/mip-opportunities/text-parser'

const cities = [
  { id: 'city-shenzhen', label: '深圳' },
  { id: 'city-beijing', label: '北京' },
]

describe('opportunity text parser', () => {
  it('recognizes explicit labeled sections and maps only a real catalog city', () => {
    const result = parseOpportunityText(`
项目名称：品牌渠道合作
价值金额：预计年度合作额 50 万元
主营城市：深圳市
寻找合作方：寻找成熟消费品渠道
展开讲讲：第一阶段覆盖华南。
后续按季度复盘。
`, cities)

    expect(result.draft).toEqual({
      title: '品牌渠道合作',
      valueSummary: '预计年度合作额 50 万元',
      cityTagId: 'city-shenzhen',
      cityLabel: '深圳',
      targetSummary: '寻找成熟消费品渠道',
      description: '第一阶段覆盖华南。\n后续按季度复盘。',
    })
    expect(result.recognizedFields).toEqual([
      'title',
      'valueSummary',
      'cityTagId',
      'targetSummary',
      'description',
    ])
  })

  it('does not invent a city or price field from unknown prose', () => {
    const result = parseOpportunityText('合作项目\n这是一段未标注的项目说明。', cities)
    expect(result.draft).toEqual({
      title: '合作项目',
      description: '这是一段未标注的项目说明。',
    })
    expect(result.draft.cityTagId).toBeUndefined()
    expect(result.draft.valueSummary).toBeUndefined()
  })

  it('ignores a city label that is absent from the server catalog', () => {
    const result = parseOpportunityText('项目名称：海外合作\n主营城市：海外', cities)
    expect(result.draft.title).toBe('海外合作')
    expect(result.draft.cityTagId).toBeUndefined()
    expect(result.recognizedFields).not.toContain('cityTagId')
  })

  it('does not append unknown labeled sections to the previous recognized field', () => {
    const result = parseOpportunityText('项目名称：渠道合作\n联系人：张三\n寻找合作方：零售渠道', cities)
    expect(result.draft.title).toBe('渠道合作')
    expect(result.draft.targetSummary).toBe('零售渠道')
    expect(JSON.stringify(result.draft)).not.toContain('张三')
  })

  it('derives the MIW-89 value-mode hint from pasted or AI text', () => {
    // 面谈/面议 → NEGOTIATION
    expect(opportunityValueHintFromText('合作金额面议，具体详谈')).toEqual({ kind: 'NEGOTIATION' })
    expect(opportunityValueHintFromText('价值：面谈')).toEqual({ kind: 'NEGOTIATION' })
    // 千 / k → 千原值；万 → 千 ×10；元 → 千 ÷1000（保留一位小数）
    expect(opportunityValueHintFromText('预算 5 千')).toEqual({ kind: 'QIAN', qian: 5 })
    expect(opportunityValueHintFromText('报酬100k')).toEqual({ kind: 'QIAN', qian: 100 })
    expect(opportunityValueHintFromText('预算50万')).toEqual({ kind: 'QIAN', qian: 500 })
    expect(opportunityValueHintFromText('合作额2.5万')).toEqual({ kind: 'QIAN', qian: 25 })
    expect(opportunityValueHintFromText('合作额 5000 元')).toEqual({ kind: 'QIAN', qian: 5 })
    expect(opportunityValueHintFromText('合作额600元')).toEqual({ kind: 'QIAN', qian: 0.6 })
    // 无金额语义 → 忽略
    expect(opportunityValueHintFromText('期权谈话')).toBeUndefined()
    expect(opportunityValueHintFromText('')).toBeUndefined()
  })
})
