import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseOpportunityAiDraft } from '../src/modules/mip-opportunities/ai-draft'

function source(relativePath: string) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8')
}

const cities = [
  { id: '', label: '全国' },
  { id: 'city-shenzhen', label: '深圳' },
  { id: 'city-shanghai', label: '上海' },
]

describe('MIP opportunity AI draft boundary', () => {
  it('keeps only supported bounded text and resolves cities through the real catalog', () => {
    const result = parseOpportunityAiDraft({
      title: '  消费品渠道合作  ',
      valueSummary: '50 万元货值',
      cityLabel: '深圳市',
      targetSummary: '寻找线下渠道',
      description: '华南地区品牌合作项目',
      roleKeys: ['connector'],
      publish: true,
    }, cities)

    expect(result).toEqual({
      draft: {
        title: '消费品渠道合作',
        valueSummary: '50 万元货值',
        cityTagId: 'city-shenzhen',
        cityLabel: '深圳',
        targetSummary: '寻找线下渠道',
        description: '华南地区品牌合作项目',
      },
      recognizedFields: ['title', 'valueSummary', 'targetSummary', 'description', 'cityTagId'],
    })
  })

  it('does not accept an unknown AI city or a non-object result', () => {
    expect(parseOpportunityAiDraft({ title: '项目', cityLabel: '不存在的城市' }, cities)).toEqual({
      draft: { title: '项目' },
      recognizedFields: ['title'],
    })
    expect(parseOpportunityAiDraft([], cities)).toEqual({ draft: {}, recognizedFields: [] })
  })

  it('bounds every field before it reaches the editor', () => {
    const result = parseOpportunityAiDraft({
      title: 'a'.repeat(200),
      valueSummary: 'b'.repeat(300),
      targetSummary: 'c'.repeat(700),
      description: 'd'.repeat(7000),
    }, cities)

    expect(result.draft.title).toHaveLength(120)
    expect(result.draft.valueSummary).toHaveLength(240)
    expect(result.draft.targetSummary).toHaveLength(500)
    expect(result.draft.description).toHaveLength(6000)
  })

  it('adds opportunity as an append-only AI draft purpose migration', () => {
    expect(source('database/mysql/mip/059_ai_opportunity_draft_purpose.sql')).toContain(
      `purpose IN ('PROFILE', 'COOPERATION_CARD', 'SUPER_CASE', 'OPPORTUNITY')`,
    )
    const lock = JSON.parse(source('database/mysql/mip/migrations.lock.json')) as {
      migrations: Array<{ name: string, altersTables: string[] }>
    }
    expect(lock.migrations.at(-1)).toMatchObject({
      name: 'mip_ai_opportunity_draft_purpose',
      altersTables: ['mip_ai_drafts'],
    })
  })
})
