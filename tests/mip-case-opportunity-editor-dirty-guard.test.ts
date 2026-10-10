import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * MIP-4：超级案例/机会编辑器的「未保存修改」返回守卫，与合作卡编辑器行为对称。
 * 覆盖口径：dirty 置位后武装原生返回确认（只武装一次）；加载完成前不武装；
 * 保存成功与页面卸载必须解除守卫，避免保存后自动返回误弹确认框。
 */
const { saveOpportunity, saveSuperCase } = vi.hoisted(() => ({
  saveOpportunity: vi.fn(),
  saveSuperCase: vi.fn(),
}))

vi.mock('../src/modules/mip-ai/client', () => ({ mipAiModule: {} }))
vi.mock('../src/modules/mip-ai/editor-loader', () => ({ loadAiEditorDraft: vi.fn() }))
vi.mock('../src/modules/mip-media/client', () => ({ mipMediaModule: {} }))
vi.mock('../src/modules/mip-cases', () => ({ superCaseModule: { get: vi.fn(), save: saveSuperCase } }))
vi.mock('../src/modules/mip-opportunities', () => ({
  opportunityModule: { get: vi.fn(), getCatalogs: vi.fn(), save: saveOpportunity },
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
type PageDefinition = Record<string, any> & { data: PageData }

const enableAlertBeforeUnload = vi.fn()
const disableAlertBeforeUnload = vi.fn()
const showToast = vi.fn()
const showModal = vi.fn()
const pageScrollTo = vi.fn()
const setNavigationBarTitle = vi.fn()
const setStorageSync = vi.fn()
const navigateBack = vi.fn()
const redirectTo = vi.fn()
let currentPages: Array<{ route?: string, options?: Record<string, string> }> = []

const definitions: PageDefinition[] = []

function definitionOf(marker: string) {
  const found = definitions.find(definition => marker in definition.data)
  if (!found) {
    throw new Error(`未捕获含 ${marker} 的页面定义`)
  }
  return found
}

function createPage(definition: PageDefinition, overrides: PageData = {}) {
  const page = Object.create(definition) as PageDefinition & Record<string, any>
  page.data = { ...structuredClone(definition.data), ...structuredClone(overrides) }
  page.setData = (patch: PageData) => Object.assign(page.data, patch)
  return page
}

function touchEvent(dataset: PageData, detail: PageData = {}) {
  return { currentTarget: { dataset }, detail }
}

beforeAll(async () => {
  vi.stubGlobal('wx', {
    showToast,
    showModal,
    pageScrollTo,
    setNavigationBarTitle,
    enableAlertBeforeUnload,
    disableAlertBeforeUnload,
    setStorageSync,
    navigateBack,
    redirectTo,
  })
  vi.stubGlobal('getCurrentPages', () => currentPages)
  vi.stubGlobal('Page', (input: PageDefinition) => {
    definitions.push(input)
  })
  vi.useFakeTimers()
  await import('../src/packages/member/mip-cases/editor/index')
  await import('../src/packages/member/mip-opportunities/editor/index')
})

beforeEach(() => {
  saveOpportunity.mockReset()
  saveSuperCase.mockReset()
  for (const stub of [
    showToast,
    showModal,
    pageScrollTo,
    setNavigationBarTitle,
    enableAlertBeforeUnload,
    disableAlertBeforeUnload,
    setStorageSync,
    navigateBack,
    redirectTo,
  ]) {
    stub.mockClear()
  }
  currentPages = []
})

describe('MIP super case editor dirty back-guard (MIP-4)', () => {
  const CASE_ALERT = '案例尚未保存，返回将丢失已填写内容'

  function editProjectName(page: PageDefinition & Record<string, any>, value = '反复横跳的项目') {
    Reflect.apply(page.updateProjectText, page, [touchEvent({ groupIndex: 0, field: 'projectName' }, { value })])
  }

  it('arms the native back confirm on the first unsaved edit and keeps it armed once', () => {
    const page = createPage(definitionOf('publicationStatus'), { state: 'ready' })

    editProjectName(page)
    expect(page.dirty).toBe(true)
    expect(enableAlertBeforeUnload).toHaveBeenCalledTimes(1)
    expect(enableAlertBeforeUnload).toHaveBeenCalledWith({ message: CASE_ALERT })

    editProjectName(page, '又改了一次')
    expect(enableAlertBeforeUnload).toHaveBeenCalledTimes(1)
  })

  it('covers every editing entry: date, city, hot city, add and remove project', () => {
    const page = createPage(definitionOf('publicationStatus'), { state: 'ready' })

    Reflect.apply(page.changeProjectStart, page, [touchEvent({ groupIndex: 0 }, { value: '2026-01-02' })])
    expect(page.dirty).toBe(true)

    Reflect.apply(page.applyCity, page, [0, '深圳', 'tag-sz'])
    expect(page.data['projects[0].cityLabel']).toBe('深圳')

    Reflect.apply(page.applyHotCity, page, [touchEvent({ groupIndex: 0 }, { label: '北京' })])
    expect(page.data['projects[0].cityLabel']).toBe('北京')

    Reflect.apply(page.addProject, page, [])
    expect(page.data.projects.length).toBe(2)
    expect(page.dirty).toBe(true)

    Reflect.apply(page.removeProject, page, [touchEvent({ groupIndex: 1 })])
    expect(page.data.projects.length).toBe(1)
    expect(page.dirty).toBe(true)
    expect(enableAlertBeforeUnload).toHaveBeenCalledTimes(1)
  })

  it('rejects out-of-range project edits without arming the guard', () => {
    const page = createPage(definitionOf('publicationStatus'), {
      state: 'ready',
      projects: Array.from({ length: 12 }, () => ({ projectName: '' })),
    })

    Reflect.apply(page.updateProjectText, page, [touchEvent({ groupIndex: 0, field: 'hacker' }, { value: 'x' })])
    Reflect.apply(page.addProject, page, [])
    expect(page.dirty).toBe(false)
    expect(enableAlertBeforeUnload).not.toHaveBeenCalled()
  })

  it('stays disarmed while the page has not finished loading', () => {
    const page = createPage(definitionOf('publicationStatus'))

    editProjectName(page)
    expect(page.dirty).toBe(false)
    expect(enableAlertBeforeUnload).not.toHaveBeenCalled()
  })

  it('disarms the guard after a successful save and navigates back without re-arming', async () => {
    const page = createPage(definitionOf('publicationStatus'), { state: 'ready' })
    editProjectName(page)
    expect(page.dirty).toBe(true)

    saveSuperCase.mockResolvedValueOnce({ id: 'case-1', version: 3, status: 'PUBLISHED' })
    await page.save()

    expect(saveSuperCase).toHaveBeenCalledTimes(1)
    expect(page.dirty).toBe(false)
    expect(disableAlertBeforeUnload).toHaveBeenCalledTimes(1)
    expect(showToast).toHaveBeenCalledWith({ title: '案例已发布', icon: 'success' })

    vi.advanceTimersByTime(600)
    expect(navigateBack).toHaveBeenCalledTimes(1)
    expect(enableAlertBeforeUnload).toHaveBeenCalledTimes(1)
  })

  it('disarms the guard when the page unloads', () => {
    const page = createPage(definitionOf('publicationStatus'), { state: 'ready' })
    editProjectName(page)
    expect(page.dirty).toBe(true)

    Reflect.apply(page.onUnload, page, [])
    expect(page.dirty).toBe(false)
    expect(disableAlertBeforeUnload).toHaveBeenCalledTimes(1)
  })
})

describe('MIP opportunity editor dirty back-guard (MIP-4)', () => {
  const OPP_ALERT = '机会尚未保存，返回将丢失已填写内容'

  it('arms the native back confirm on the first unsaved edit and keeps it armed once', () => {
    const page = createPage(definitionOf('typeOptions'), { state: 'ready' })

    Reflect.apply(page.updateText, page, [touchEvent({ field: 'title' }, { value: '找腾讯的合作' })])
    expect(page.dirty).toBe(true)
    expect(enableAlertBeforeUnload).toHaveBeenCalledTimes(1)
    expect(enableAlertBeforeUnload).toHaveBeenCalledWith({ message: OPP_ALERT })

    Reflect.apply(page.updateText, page, [touchEvent({ field: 'description' }, { value: '补充说明' })])
    expect(enableAlertBeforeUnload).toHaveBeenCalledTimes(1)
  })

  it('marks dirty from paste recognition, city, type, status and visibility edits', () => {
    const page = createPage(definitionOf('typeOptions'), { state: 'ready' })

    Reflect.apply(page.applyPastedDraft, page, [{ title: '识别出的机会' }])
    expect(page.dirty).toBe(true)
    expect(enableAlertBeforeUnload).toHaveBeenCalledWith({ message: OPP_ALERT })

    const second = createPage(definitionOf('typeOptions'), { state: 'ready' })
    const armedBefore = enableAlertBeforeUnload.mock.calls.length
    Reflect.apply(second.toggleTypeOption, second, [touchEvent({ key: 'COMPANY' })])
    expect(second.data.typeOptions.find((item: { key: string }) => item.key === 'COMPANY').selected).toBe(true)
    expect(second.dirty).toBe(true)

    Reflect.apply(second.chooseVisibility, second, [touchEvent({ visibility: 'INTERNAL' })])
    expect(second.data.playersOnly).toBe(true)

    Reflect.apply(second.chooseProjectStatus, second, [touchEvent({ key: 'RECRUITING' })])
    expect(second.data.projectStatus).toBe('RECRUITING')
    expect(second.data.statusSheetVisible).toBe(false)

    Reflect.apply(second.changeCity, second, [touchEvent({}, { value: '0' })])
    expect(second.dirty).toBe(true)
    // 只武装一次是实例级不变量：second 首次改动已武装，后续改动不重复注册
    expect(enableAlertBeforeUnload.mock.calls.length).toBe(armedBefore + 1)
  })

  it('stays disarmed while the page has not finished loading', () => {
    const page = createPage(definitionOf('typeOptions'))

    Reflect.apply(page.updateText, page, [touchEvent({ field: 'title' }, { value: '还没加载完' })])
    expect(page.dirty).toBe(false)
    expect(enableAlertBeforeUnload).not.toHaveBeenCalled()
  })

  it('disarms the guard after a successful publish and lands on the detail page without the alert', async () => {
    const page = createPage(definitionOf('typeOptions'), {
      state: 'ready',
      title: '找腾讯的合作',
      valueSummary: '年度框架资源',
      targetSummary: '寻找对接人',
    })
    Reflect.apply(page.updateText, page, [touchEvent({ field: 'title' }, { value: '找腾讯的合作（改）' })])
    expect(page.dirty).toBe(true)

    currentPages = [{ route: 'packages/member/mip-opportunities/list/index' }]
    saveOpportunity.mockResolvedValueOnce({ id: 'opp-1', version: 5, status: 'PUBLISHED' })
    await page.save(true)

    expect(saveOpportunity).toHaveBeenCalledTimes(1)
    expect(page.dirty).toBe(false)
    expect(disableAlertBeforeUnload).toHaveBeenCalledTimes(1)
    expect(setStorageSync).toHaveBeenCalled()
    expect(showToast).toHaveBeenCalledWith({ title: '机会已发布', icon: 'success' })

    vi.advanceTimersByTime(600)
    expect(redirectTo).toHaveBeenCalledWith({ url: '/packages/member/mip-opportunities/detail/index?id=opp-1' })
    expect(navigateBack).not.toHaveBeenCalled()
    expect(enableAlertBeforeUnload).toHaveBeenCalledTimes(1)
  })

  it('re-arms the guard when the user edits again after a successful save', async () => {
    const page = createPage(definitionOf('typeOptions'), {
      state: 'ready',
      title: '找腾讯的合作',
      valueSummary: '年度框架资源',
      targetSummary: '寻找对接人',
    })
    saveOpportunity.mockResolvedValueOnce({ id: 'opp-1', version: 5, status: 'PUBLISHED' })
    await page.save(true)
    expect(page.dirty).toBe(false)
    expect(enableAlertBeforeUnload).not.toHaveBeenCalled()

    Reflect.apply(page.updateText, page, [touchEvent({ field: 'title' }, { value: '保存后又改了' })])
    expect(page.dirty).toBe(true)
    expect(enableAlertBeforeUnload).toHaveBeenCalledTimes(1)
  })

  it('disarms the guard when the page unloads', () => {
    const page = createPage(definitionOf('typeOptions'), { state: 'ready' })
    Reflect.apply(page.updateText, page, [touchEvent({ field: 'title' }, { value: '未保存' })])
    expect(page.dirty).toBe(true)

    Reflect.apply(page.onUnload, page, [])
    expect(page.dirty).toBe(false)
    expect(disableAlertBeforeUnload).toHaveBeenCalledTimes(1)
  })
})

afterAll(() => {
  vi.useRealTimers()
})
