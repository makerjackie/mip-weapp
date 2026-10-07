import type { SuperCaseDraft } from '../src/modules/mip-cases/types'
import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { collectMissingProjectFields, normalizeSuperCaseDraft } from '../src/modules/mip-cases/validation'

describe('MIP super case contracts', () => {
  it('shows complete case media and opens the native image preview', () => {
    const source = fs.readFileSync(new URL('../src/packages/member/mip-cases/detail/index.ts', import.meta.url), 'utf8')
    const view = fs.readFileSync(new URL('../src/packages/member/mip-cases/detail/index.wxml', import.meta.url), 'utf8')
    const editorSource = fs.readFileSync(new URL('../src/packages/member/mip-cases/editor/index.ts', import.meta.url), 'utf8')
    const editorView = fs.readFileSync(new URL('../src/packages/member/mip-cases/editor/index.wxml', import.meta.url), 'utf8')
    expect(source).toContain('wx.previewImage({ current, urls })')
    expect(view).toContain('mode="widthFix"')
    expect(view).toContain('bind:tap="previewImage"')
    expect(view).not.toContain('h-[420rpx]')
    // MIW-49（figma 2173_42605）：编辑页去掉案例素材/展示素材上传，只保留媒体资产透传。
    expect(editorSource).not.toContain('uploadImageFromPath')
    expect(editorSource).toContain('mediaAssetIds')
    expect(editorView).not.toContain('bind:tap="previewMedia"')
  })

  it('normalizes optional classification and de-duplicates media assets', () => {
    const normalized = normalizeSuperCaseDraft({
      projectName: '品牌升级项目',
      summary: '完成品牌定位和视觉升级',
      startedOn: '2026-01-01',
      endedOn: '2026-03-31',
      responsibility: '负责策略和项目统筹',
      cityTagId: 'city-1',
      industryTagId: 'industry-1',
      region: '总部在深圳，2026 大湾区扩张中',
      caseType: '品牌升级',
      description: '项目按计划完成并交付。',
      mediaAssetIds: ['asset-1', 'asset-1', 'asset-2'],
      publish: true,
      projects: [],
    })
    expect(normalized.mediaAssetIds).toEqual(['asset-1', 'asset-2'])
    expect(normalized.startedOn).toBe('2026-01-01')
    // 兼容镜像：无 projects 时旧的扁平字段包装为第 1 个项目。
    expect(normalized.projects).toHaveLength(1)
    expect(normalized.projects[0]).toMatchObject({
      projectName: '品牌升级项目',
      cityTagId: 'city-1',
      region: '总部在深圳，2026 大湾区扩张中',
      caseType: '品牌升级',
    })
    expect(normalized.projectName).toBe('品牌升级项目')
  })

  it('keeps submitted projects and mirrors the first one into legacy flat fields', () => {
    const normalized = normalizeSuperCaseDraft({
      projectName: '',
      summary: '',
      responsibility: '',
      description: '',
      mediaAssetIds: [],
      publish: false,
      projects: [
        {
          projectName: '项目A',
          summary: '描述A',
          startedOn: '2026-01-01',
          responsibility: '职责A',
          cityTagId: 'city-1',
          region: '深圳',
          caseType: '品牌升级',
          description: '说明A',
        },
        { projectName: '项目B', summary: '描述B', responsibility: '职责B', description: '' },
      ],
    })
    expect(normalized.projects).toHaveLength(2)
    expect(normalized.projects[1].projectName).toBe('项目B')
    expect(normalized.projectName).toBe('项目A')
    expect(normalized.summary).toBe('描述A')
    expect(normalized.cityTagId).toBe('city-1')
  })

  it('blocks publish with missing required fields but keeps drafts allowed', () => {
    const partial = {
      projectName: '',
      summary: '',
      responsibility: '',
      description: '',
      mediaAssetIds: [],
      projects: [
        { projectName: '项目A', summary: '描述A', responsibility: '职责A', description: '' },
      ] as SuperCaseDraft['projects'],
    }
    expect(normalizeSuperCaseDraft({ ...partial, publish: false }).projects).toHaveLength(1)
    expect(() => normalizeSuperCaseDraft({ ...partial, publish: true })).toThrow('请完整填写案例项目必填项')
    const missing = collectMissingProjectFields(partial.projects)
    expect(missing).toEqual(['请填写开始时间', '请填写主营城市', '请填写主营地区', '请填写项目类型'])
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
      projects: [],
    })).toThrow('结束日期不能早于开始日期')
  })
})
