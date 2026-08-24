import { describe, expect, it } from 'vitest'
import { normalizeSuperCaseDraft } from '../src/modules/mip-cases/validation'

describe('MIP super case contracts', () => {
  it('normalizes optional classification and de-duplicates media assets', () => {
    const normalized = normalizeSuperCaseDraft({
      projectName: '品牌升级项目',
      summary: '完成品牌定位和视觉升级',
      startedOn: '2026-01-01',
      endedOn: '2026-03-31',
      responsibility: '负责策略和项目统筹',
      cityTagId: 'city-1',
      industryTagId: 'industry-1',
      caseType: '品牌升级',
      description: '项目按计划完成并交付。',
      mediaAssetIds: ['asset-1', 'asset-1', 'asset-2'],
      publish: true,
    })
    expect(normalized.mediaAssetIds).toEqual(['asset-1', 'asset-2'])
    expect(normalized.startedOn).toBe('2026-01-01')
  })

  it('rejects a reversed date range', () => {
    expect(() => normalizeSuperCaseDraft({
      projectName: '项目',
      summary: '项目说明',
      startedOn: '2026-03-01',
      endedOn: '2026-02-01',
      responsibility: '项目职责',
      description: '项目详细说明',
      mediaAssetIds: [],
      publish: false,
    })).toThrow('结束日期不能早于开始日期')
  })
})
