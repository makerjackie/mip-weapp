import type { AtRule, Container, Root, Rule } from 'postcss'

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import postcss from 'postcss'
import { describe, expect, it } from 'vitest'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function read(relativePath: string) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

function declarations(rule: Rule) {
  return Object.fromEntries(
    rule.nodes
      .filter(node => node.type === 'decl')
      .map(node => [node.prop, node.value]),
  )
}

function ruleWith(container: Container, selector: string, property: string, topLevel = false) {
  const matches: Rule[] = []
  if (topLevel) {
    for (const candidate of container.nodes || []) {
      if (candidate.type === 'rule' && candidate.selectors.includes(selector) && candidate.nodes.some(node => node.type === 'decl' && node.prop === property)) {
        matches.push(candidate)
      }
    }
  }
  else {
    container.walkRules((candidate) => {
      if (candidate.selectors.includes(selector) && candidate.nodes.some(node => node.type === 'decl' && node.prop === property)) {
        matches.push(candidate)
      }
    })
  }
  expect(matches).toHaveLength(1)
  return matches[0]
}

function media(stylesheet: Root, params: string) {
  const matches = stylesheet.nodes.filter(
    (node): node is AtRule => node.type === 'atrule' && node.name === 'media' && node.params === params,
  )
  expect(matches).toHaveLength(1)
  return matches[0]
}

describe('MIP super case editor visual contract', () => {
  const page = read('src/packages/member/mip-cases/editor/index.ts')
  const template = read('src/packages/member/mip-cases/editor/index.wxml')
  const config = JSON.parse(read('src/packages/member/mip-cases/editor/index.json')) as {
    navigationBarTitleText: string
    navigationBarBackgroundColor: string
    navigationBarTextStyle: string
  }
  const stylesheet = postcss.parse(read('src/packages/member/mip-cases/editor/index.wxss'))

  it('adapts the frozen Figma hierarchy to the native page shell', () => {
    expect(config).toMatchObject({
      navigationBarTitleText: '超级案例',
      navigationBarBackgroundColor: '#080808',
      navigationBarTextStyle: 'white',
    })
    expect(template).toContain('做过哪些展现您能力的超级案例')
    expect(template).toContain('border-brand bg-panel')
    expect(template).toContain('AI助手')
    expect(template).toContain('bind:tap="onAiAssistant"')
    expect(template).toContain('>我的案例</view>')
    expect(template).toContain('case-editor-field-group')
    expect(template).toContain('case-editor-field-row')
    expect(template).toContain('项目名称')
    expect(template).toContain('一句话描述案例')
    expect(template).toContain('开始时间')
    expect(template).toContain('担任职责')
    expect(template).toContain('主营城市')
    expect(template).toContain('主营地区')
    expect(template).toContain('项目类型')
    expect(template).toContain('展开讲讲（选填）')
    expect(template).not.toMatch(/创建超级案例|填写真实项目经历。发布前/)
    expect(template).not.toContain('figmaEditor')
    expect(page).not.toContain('figmaEditor')
  })

  it('appends whole project groups and prompts for missing required fields on publish', () => {
    expect(template).toContain('wx:for="{{projects}}"')
    expect(template).toContain('data-group-index="{{groupIndex}}"')
    expect(template).toContain('aria-label="添加项目"')
    expect(template).toContain('bind:tap="addProject"')
    expect(template).toContain('bind:tap="removeProject"')
    expect(page).toContain('MAX_SUPER_CASE_PROJECTS')
    expect(page).toContain('collectMissingProjectFields(this.draftProjects(this.data.cityOptions))')
    expect(page).toContain('还有必填项未填写')
    expect(page).toContain('confirmText: \'去填写\'')
    expect(page).toContain('projects: [...this.data.projects, emptyProject()]')
    expect(template).toContain('maxlength="300"')
    expect(template).toContain('{{project.description.length}}/300')
  })

  it('keeps the real draft, catalogue, AI, media, and publication contracts', () => {
    expect(page).toContain('opportunityModule.getCatalogs()')
    expect(page).toContain('superCaseModule.get(this.data.id)')
    expect(page).toContain('loadAiEditorDraft(this.data.aiDraftId, \'SUPER_CASE\')')
    expect(page).toContain('uploadImageFromPath(\'SUPER_CASE_COVER\'')
    expect(page).toContain('uploadImageFromPath(\'SUPER_CASE_MEDIA\'')
    expect(page).toContain('wx.previewImage({ current, urls })')
    expect(page).toContain('const draft: SuperCaseDraft = {')
    expect(page).toContain('await superCaseModule.save(draft)')
    for (const field of [
      'projectName',
      'summary',
      'startedOn',
      'responsibility',
      'cityTagId',
      'caseType',
      'description',
      'projects',
      'coverAssetId',
      'mediaAssetIds',
      'aiConfirmation',
    ]) {
      expect(page).toContain(`${field}:`)
    }
    expect(page).toContain('publish,')
    for (const handler of [
      'updateProjectText',
      'changeProjectStart',
      'changeProjectCity',
      'chooseCover',
      'addMedia',
      'previewMedia',
      'removeMedia',
      'saveDraft',
      'publish',
    ]) {
      expect(
        template.includes(`bind:tap="${handler}"`)
        || template.includes(`bindchange="${handler}"`)
        || template.includes(`bindinput="${handler}"`),
      ).toBe(true)
    }
    expect(template).toContain('{{publicationStatusText}}')
    expect(template).toContain('<app-page-exit always label="取消" />')
  })

  it('uses the exact exported Figma glyphs without remote runtime assets', () => {
    for (const asset of ['ai-assistant.svg', 'case-section.svg', 'calendar.svg', 'chevron.svg']) {
      const assetPath = `src/packages/member/mip-cases/editor/assets/${asset}`
      expect(fs.existsSync(path.join(root, assetPath))).toBe(true)
      expect(template).toContain(`/packages/member/mip-cases/editor/assets/${asset}`)
      expect(read(assetPath)).toContain('<svg')
    }
    expect(template).not.toContain('https://www.figma.com/api/mcp/asset/')
  })

  it('keeps compact phone rows and expands forms and media at both desktop breakpoints', () => {
    expect(declarations(ruleWith(stylesheet, '.case-editor-form-layout', 'display', true))).toMatchObject({
      'display': 'grid',
      'grid-template-columns': 'minmax(0, 1fr)',
      'gap': '32rpx',
    })
    expect(declarations(ruleWith(stylesheet, '.case-editor-field-row', 'min-height', true))).toMatchObject({
      'display': 'grid',
      'grid-template-columns': 'max-content minmax(0, 1fr)',
      'min-height': '92rpx',
    })
    expect(declarations(ruleWith(stylesheet, '.case-editor-media-grid', 'display', true))).toMatchObject({
      'display': 'grid',
      'grid-template-columns': 'repeat(2, minmax(0, 1fr))',
    })

    for (const query of ['(min-width: 600px) and (max-width: 959px)', '(min-width: 960px)']) {
      const breakpoint = media(stylesheet, query)
      expect(declarations(ruleWith(breakpoint, '.case-editor-form-layout', 'grid-template-columns'))).toMatchObject({
        'grid-template-columns': 'repeat(2, minmax(0, 1fr))',
      })
      expect(declarations(ruleWith(breakpoint, '.case-editor-media-layout', 'grid-template-columns'))).toMatchObject({
        'grid-template-columns': 'repeat(2, minmax(0, 1fr))',
      })
      expect(declarations(ruleWith(breakpoint, '.case-editor-field-row', 'min-height'))).toMatchObject({
        'min-height': '52px',
      })
    }
  })

  it('separates draft and publish progress in one constrained fixed action bar', () => {
    expect(template).toContain('id="case-editor-fixed-actions"')
    expect(template).toContain('<mip-sticky-actions>')
    expect(template).toContain('slot="actions"')
    expect(template).toContain('grid-cols-2')
    expect(template).toContain('savingIntent === \'draft\'')
    expect(template).toContain('savingIntent === \'publish\'')
    expect(template).toContain('bind:tap="saveDraft"')
    expect(template).toContain('bind:tap="publish"')
    expect(page).toContain('savingIntent: publish ? \'publish\' : \'draft\'')
    expect(page).toContain('this.setData({ saving: false, savingIntent: \'\' })')
  })
})
