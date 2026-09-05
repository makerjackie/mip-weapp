import { readFileSync } from 'node:fs'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/modules/mip-ai/client', () => ({ mipAiModule: {} }))
vi.mock('../src/modules/mip-ai/editor-loader', () => ({ loadAiEditorDraft: vi.fn() }))
vi.mock('../src/modules/mip-media/client', () => ({ mipMediaModule: {} }))
vi.mock('../src/modules/mip-opportunities', () => ({ opportunityModule: {} }))
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
    expect(view).not.toContain('展开讲讲（选填）')
    expect(view).toContain('必填，至少选择一种')
    expect(view).toContain('aria-role="checkbox"')
    expect(view).toContain('aria-checked="{{item.selected}}"')
  })

  it('shows inline errors and scrolls to the first missing field', () => {
    const page = createPage()

    expect(Reflect.apply(page.validateRequiredFields, page, [])).toBe(false)
    expect(page.data.titleError).toBe('请输入项目名称。')
    expect(page.data.descriptionError).toBe('请输入项目说明。')
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
})
