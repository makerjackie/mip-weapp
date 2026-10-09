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
    usingComponents: Record<string, string>
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

  it('keeps all project fields in one shared form panel per project', () => {
    // figma 2173_42605：热门城市标签位于主营城市与主营地区之间，整组字段同一 panel 背景。
    const groupStart = template.indexOf('<view class="case-editor-field-group">')
    const cityRow = template.indexOf('主营城市', groupStart)
    const hotBlock = template.indexOf('case-editor-hot-cities', groupStart)
    const regionRow = template.indexOf('主营地区', groupStart)
    const typeRow = template.indexOf('项目类型', groupStart)
    const description = template.indexOf('展开讲讲（选填）', groupStart)
    const groupEnd = template.indexOf('</view>\n      </view>\n      </view>', groupStart)
    expect(groupStart).toBeGreaterThan(-1)
    expect(cityRow).toBeGreaterThan(groupStart)
    expect(hotBlock).toBeGreaterThan(cityRow)
    expect(regionRow).toBeGreaterThan(hotBlock)
    expect(typeRow).toBeGreaterThan(regionRow)
    expect(description).toBeGreaterThan(typeRow)
    expect(groupEnd).toBeGreaterThan(description)
    // 项目之间的旧 180rpx 空隙已随分体表单一起移除。
    expect(template).not.toContain('gap-[180rpx]')
  })

  it('offers eight quick hot cities with the shared tag chip inside the city field group', () => {
    // 标注 2127_2195：主营城市使用城市标签库；标签组件 mip-tag-chip 渲染快捷项。
    expect(config.usingComponents['mip-tag-chip']).toBe('/components/mip-tag-chip/index')
    expect(template).toContain('<mip-tag-chip')
    expect(template).toContain('active="{{project.cityLabel === hotCity.label}}"')
    expect(page).toContain('EDITOR_HOT_CITY_COUNT')
    expect(page).toContain('HOT_CITY_LABELS.slice(0, EDITOR_HOT_CITY_COUNT)')
    expect(page).toMatch(/hotCities: HOT_CITY_LABELS\.slice\(0, EDITOR_HOT_CITY_COUNT\)[\s\S]*cityTagIdOf/)
  })

  it('routes 主营城市 to the dedicated city selector page instead of a native picker', () => {
    // figma 2215_4618：点击选择城市进入二级城市选择页，EventChannel 带回 label/tagId。
    expect(template).not.toContain('picker mode="selector"')
    expect(template).toContain('bind:tap="openCitySelector"')
    expect(template).toContain('请选择城市')
    expect(page).toContain('/packages/member/mip-cases/city-selector/index?selected=')
    expect(page).toContain('citySelected')
    expect(page).toContain('applyCity(groupIndex, label')
    expect(template).toContain('bind:tap="applyHotCity"')
  })

  it('appends whole project groups and prompts for missing required fields on save', () => {
    expect(template).toContain('wx:for="{{projects}}"')
    expect(template).toContain('data-group-index="{{groupIndex}}"')
    expect(template).toContain('aria-label="添加项目"')
    expect(template).toContain('bind:tap="addProject"')
    expect(template).toContain('bind:tap="removeProject"')
    expect(page).toContain('MAX_SUPER_CASE_PROJECTS')
    expect(page).toContain('collectMissingProjectFields(this.draftProjects())')
    expect(page).toContain('还有必填项未填写')
    expect(page).toContain('confirmText: \'去填写\'')
    expect(page).toContain('projects: [...this.data.projects, emptyProject()]')
    expect(template).toContain('maxlength="300"')
    expect(template).toContain('{{project.description.length}}/300')
  })

  it('keeps the real catalogue, AI, and publication contracts without media upload UI', () => {
    expect(page).toContain('opportunityModule.getCatalogs()')
    expect(page).toContain('superCaseModule.get(this.data.id)')
    expect(page).toContain('loadAiEditorDraft(this.data.aiDraftId, \'SUPER_CASE\')')
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
    expect(page).toContain('publish: true')
    // 案例素材/展示素材/取消 不在设计稿内（figma 2173_42605）。
    expect(page).not.toContain('uploadImageFromPath')
    expect(page).not.toContain('mipMediaModule')
    expect(template).not.toContain('案例素材')
    expect(template).not.toContain('展示素材')
    expect(template).not.toContain('app-page-exit always')
    for (const handler of [
      'updateProjectText',
      'changeProjectStart',
      'openCitySelector',
      'applyHotCity',
      'saveCase',
    ]) {
      expect(
        template.includes(`bind:tap="${handler}"`)
        || template.includes(`bindchange="${handler}"`)
        || template.includes(`bindinput="${handler}"`),
      ).toBe(true)
    }
    expect(template).not.toContain('bind:tap="saveDraft"')
    expect(template).not.toContain('bind:tap="publish"')
    expect(template).toContain('{{publicationStatusText}}')
  })

  it('uses the exact exported Figma glyphs without remote runtime assets', () => {
    for (const asset of ['ai-assistant.svg', 'case-section.svg', 'calendar.svg', 'chevron.svg']) {
      const assetPath = `src/packages/member/mip-cases/editor/assets/${asset}`
      expect(fs.existsSync(path.join(root, assetPath))).toBe(true)
      expect(template).toContain(`/packages/member/mip-cases/editor/assets/${asset}`)
      expect(read(assetPath)).toContain('<svg')
    }
    expect(read('src/packages/member/mip-cases/editor/assets/chevron.svg')).toContain('stroke="#FFFFFF"')
    expect(template).not.toContain('https://www.figma.com/api/mcp/asset/')
  })

  it('keeps compact phone rows and expands forms at both desktop breakpoints', () => {
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
    expect(declarations(ruleWith(stylesheet, '.case-editor-hot-cities', 'display', true))).toMatchObject({
      'display': 'grid',
      'grid-template-columns': 'repeat(4, minmax(0, 1fr))',
      'background': 'var(--color-panel)',
    })

    for (const query of ['(min-width: 600px) and (max-width: 959px)', '(min-width: 960px)']) {
      const breakpoint = media(stylesheet, query)
      expect(declarations(ruleWith(breakpoint, '.case-editor-form-layout', 'grid-template-columns'))).toMatchObject({
        'grid-template-columns': 'repeat(2, minmax(0, 1fr))',
      })
      expect(declarations(ruleWith(breakpoint, '.case-editor-field-row', 'min-height'))).toMatchObject({
        'min-height': '52px',
      })
    }
  })

  it('keeps one save action in the fixed bottom bar', () => {
    expect(template).toContain('id="case-editor-fixed-actions"')
    expect(template).toContain('<mip-sticky-actions>')
    expect(template).toContain('slot="actions"')
    expect(template).toContain('label="保存"')
    expect(template).toContain('bind:tap="saveCase"')
    expect(template).not.toContain('保存草稿')
    expect(template).not.toContain('保存修改')
    expect(page).toContain('publish: true')
    expect(page).toContain('this.setData({ saving: false })')
  })

  it('warns on back navigation with unsaved edits and disarms after save (MIP-4)', () => {
    expect(page).toContain('wx.enableAlertBeforeUnload')
    expect(page).toContain('wx.disableAlertBeforeUnload')
    expect(page).toMatch(/touch\(\)/)
    expect(page).toMatch(/markClean\(\)/)
  })
})
