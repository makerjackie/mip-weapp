import { readFileSync } from 'node:fs'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/modules/mip-ai/client', () => ({ mipAiModule: {} }))
vi.mock('../src/modules/mip-ai/editor-loader', () => ({ loadAiEditorDraft: vi.fn() }))
vi.mock('../src/modules/mip-media/client', () => ({ mipMediaModule: {} }))
vi.mock('../src/modules/mip-opportunities', () => ({
  opportunityModule: {},
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
    // journey-review 复审：服务端强制 description 必填（VALIDATION_FAILED），
    // 恢复必填呈现：标签去「（选填）」、带必填徽记。
    const descriptionBlock = view.slice(
      view.indexOf('id="opportunity-field-description"'),
      view.indexOf('id="opportunity-field-roles"'),
    )
    expect(descriptionBlock).toContain('<text>展开讲讲</text>')
    expect(descriptionBlock).not.toContain('（选填）')
    expect(descriptionBlock).toContain('>必填</text>')
    expect(descriptionBlock).toContain('aria-label="展开讲讲，必填"')
    expect(view).toContain('必填，至少选择一种')
    expect(view).toContain('aria-role="checkbox"')
    expect(view).toContain('aria-checked="{{item.selected}}"')
  })

  it('shows inline errors and scrolls to the first missing field', () => {
    const page = createPage()

    expect(Reflect.apply(page.validateRequiredFields, page, [])).toBe(false)
    expect(page.data.titleError).toBe('请输入项目名称。')
    expect(page.data.descriptionError).toBe('请展开讲讲你的项目情况。')
    expect(page.data.roleError).toBe('请至少选择一种合作角色。')
    expect(showToast).toHaveBeenCalledWith({ title: '请输入项目名称。', icon: 'none' })
    expect(pageScrollTo).toHaveBeenCalledWith({ selector: '#opportunity-field-title', duration: 200 })
  })

  it('targets description before roles and passes after all required fields are present', () => {
    const roleOptions = definition.data.roleOptions.map((role: { key: string }) => ({ ...role, selected: false }))
    const page = createPage({
      title: '项目',
      valueSummary: '资源互换',
      targetSummary: '寻找渠道合作方',
      description: '',
      roleOptions,
    })

    expect(Reflect.apply(page.validateRequiredFields, page, [])).toBe(false)
    expect(pageScrollTo).toHaveBeenLastCalledWith({ selector: '#opportunity-field-description', duration: 200 })

    page.data.description = '项目说明'
    expect(Reflect.apply(page.validateRequiredFields, page, [])).toBe(false)
    expect(pageScrollTo).toHaveBeenLastCalledWith({ selector: '#opportunity-field-roles', duration: 200 })

    page.data.roleOptions[0].selected = true
    expect(Reflect.apply(page.validateRequiredFields, page, [])).toBe(true)
    expect(page.data.descriptionError).toBe('')
    expect(page.data.roleError).toBe('')
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
