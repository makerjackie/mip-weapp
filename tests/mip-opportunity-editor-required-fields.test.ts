import { readFileSync } from 'node:fs'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { saveOpportunity } = vi.hoisted(() => ({ saveOpportunity: vi.fn() }))

vi.mock('../src/modules/mip-ai/client', () => ({ mipAiModule: {} }))
vi.mock('../src/modules/mip-ai/editor-loader', () => ({ loadAiEditorDraft: vi.fn() }))
vi.mock('../src/modules/mip-media/client', () => ({ mipMediaModule: {} }))
vi.mock('../src/modules/mip-opportunities', () => ({
  opportunityModule: { save: saveOpportunity },
  journeyStatusOf: (item: { status: string }) => item.status,
  opportunityTypeOptions: [
    { key: 'COMPANY', label: '找企业' },
    { key: 'RESOURCE', label: '找资源' },
    { key: 'PARTNER', label: '找伙伴' },
  ],
  opportunityProjectStatusOptions: [
    { key: 'RECRUITING', label: '招募中', description: '想合作的人将通知你' },
    { key: 'ENDED', label: '结束项目', description: '不再招募' },
    { key: 'UNPUBLISHED', label: '下架项目', description: '仅自己可见' },
  ],
}))
vi.mock('../src/platform/wechat/image-upload', () => ({ chooseSingleImage: vi.fn() }))

type PageData = Record<string, any>
type PageDefinition = Record<string, any> & {
  data: PageData
  setData: (patch: PageData) => void
}

let definition: PageDefinition
const showToast = vi.fn()
const pageScrollTo = vi.fn()

function source(relativePath: string) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8')
}

function createPage(overrides: PageData = {}) {
  const page = Object.create(definition) as PageDefinition
  page.data = { ...structuredClone(definition.data), ...structuredClone(overrides) }
  page.setData = patch => Object.assign(page.data, patch)
  return page
}

beforeAll(async () => {
  vi.stubGlobal('wx', { showToast, pageScrollTo })
  vi.stubGlobal('Page', (input: PageDefinition) => {
    definition = input
  })
  await import('../src/packages/member/mip-opportunities/editor/index')
})

beforeEach(() => {
  saveOpportunity.mockReset()
  showToast.mockClear()
  pageScrollTo.mockClear()
})

describe('MIP opportunity editor required fields', () => {
  it('keeps every required field and cooperation roles in the basic section', () => {
    const view = source('src/packages/member/mip-opportunities/editor/index.wxml')
    const advancedTrigger = view.indexOf('更多设置')

    for (const id of [
      'opportunity-field-title',
      'opportunity-field-value-summary',
      'opportunity-field-target-summary',
      'opportunity-field-description',
      'opportunity-field-roles',
    ]) {
      expect(view).toContain(`id="${id}"`)
      expect(view.indexOf(`id="${id}"`)).toBeLessThan(advancedTrigger)
    }
    // J4-04 marks description optional while retaining its 300-character input limit.
    const descriptionBlock = view.slice(
      view.indexOf('id="opportunity-field-description"'),
      view.indexOf('id="opportunity-field-roles"'),
    )
    expect(descriptionBlock).toContain('<text>展开讲讲（选填）</text>')
    expect(descriptionBlock).not.toContain('>必填</text>')
    expect(descriptionBlock).toContain('maxlength="300"')
    expect(descriptionBlock).toContain('aria-label="展开讲讲，选填，最多300字"')
    expect(view).toContain('必填，至少选择一种')
    expect(view).toContain('aria-role="checkbox"')
    expect(view).toContain('aria-checked="{{item.selected}}"')
  })

  it('shows inline errors and scrolls to the first missing field', () => {
    const page = createPage()

    expect(Reflect.apply(page.validateRequiredFields, page, [])).toBe(false)
    expect(page.data.titleError).toBe('请输入项目名称。')
    expect(page.data.valueSummaryError).toBe('请输入价值金额或价值说明。')
    expect(page.data.targetSummaryError).toBe('请输入寻找合作方的说明。')
    expect(page.data.roleError).toBe('请至少选择一种合作角色。')
    expect(showToast).toHaveBeenCalledWith({ title: '请输入项目名称。', icon: 'none' })
    expect(pageScrollTo).toHaveBeenCalledWith({ selector: '#opportunity-field-title', duration: 200 })
  })

  it('accepts an empty description while still requiring a cooperation role', () => {
    const roleOptions = definition.data.roleOptions.map((role: { key: string }) => ({ ...role, selected: false }))
    const page = createPage({
      title: '项目',
      valueSummary: '资源互换',
      targetSummary: '寻找渠道合作方',
      description: '',
      roleOptions,
    })

    expect(Reflect.apply(page.validateRequiredFields, page, [])).toBe(false)
    expect(pageScrollTo).toHaveBeenLastCalledWith({ selector: '#opportunity-field-roles', duration: 200 })

    page.data.roleOptions[0].selected = true
    expect(Reflect.apply(page.validateRequiredFields, page, [])).toBe(true)
    expect(page.data.description).toBe('')
    expect(page.data.roleError).toBe('')
  })

  it.each([false, true])('immediately reports failed saves without exposing provider details in a toast (publish=%s)', async (publish) => {
    const page = createPage({
      title: '项目',
      valueSummary: '资源互换',
      targetSummary: '寻找合作方',
      description: '',
      roleOptions: [{ key: 'strategist', name: '策划', selected: true }],
    })
    const error = new Error('内容安全服务暂不可用（provider-code: TEST_ONLY）')
    let rejectSave!: (error: Error) => void
    saveOpportunity.mockReturnValueOnce(new Promise((_, reject) => {
      rejectSave = reject
    }))
    const submission = page.save(publish)
    await page.save(publish)
    expect(saveOpportunity).toHaveBeenCalledTimes(1)
    expect(page.data.saving).toBe(true)
    expect(showToast).not.toHaveBeenCalled()

    rejectSave(error)
    await submission
    expect(showToast).toHaveBeenCalledWith({ title: '保存失败，请重试', icon: 'none' })
    expect(page.data.message).toBe(error.message)
    expect(page.data.saving).toBe(false)
    expect(page.data.title).toBe('项目')
    expect(page.data.description).toBe('')
    expect(page.navigationTimer).toBeUndefined()

    saveOpportunity.mockRejectedValueOnce(error)
    await page.save(publish)
    expect(saveOpportunity).toHaveBeenCalledTimes(2)
  })

  it('greys out unpublish and create-mode end in the status sheet', () => {
    // CREATE 模式不可直接下架或结束；发布后两种状态均可在同一次保存中提交。
    const createViews = definition.data.projectStatusOptions
    expect(createViews.find((item: { key: string }) => item.key === 'RECRUITING')).toMatchObject({ disabled: false })
    expect(createViews.find((item: { key: string }) => item.key === 'UNPUBLISHED')).toMatchObject({
      disabled: true,
      disabledNote: '发布后可调整状态',
    })
    expect(createViews.find((item: { key: string }) => item.key === 'ENDED')).toMatchObject({ disabled: true })

    const page = createPage({ statusSheetVisible: true })
    Reflect.apply(page.chooseProjectStatus, page, [
      { currentTarget: { dataset: { key: 'UNPUBLISHED' } } },
    ])
    expect(page.data.projectStatus).toBe('RECRUITING')
    expect(page.data.statusSheetVisible).toBe(true)

    Reflect.apply(page.chooseProjectStatus, page, [
      { currentTarget: { dataset: { key: 'ENDED' } } },
    ])
    expect(page.data.projectStatus).toBe('RECRUITING')
    expect(page.data.statusSheetVisible).toBe(true)

    Reflect.apply(page.chooseProjectStatus, page, [
      { currentTarget: { dataset: { key: 'RECRUITING' } } },
    ])
    expect(page.data.projectStatus).toBe('RECRUITING')
    expect(page.data.statusSheetVisible).toBe(false)

    // 编辑已有机会（DRAFT/PUBLISHED）时按 editorMode 重算：结束项目恢复可选。
    const script = source('src/packages/member/mip-opportunities/editor/index.ts')
    expect(script).toContain('projectStatusOptions: projectStatusOptionViews(editorMode)')
  })
})
