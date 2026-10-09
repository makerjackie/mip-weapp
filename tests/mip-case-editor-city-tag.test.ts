import type { SuperCaseDetail } from '../src/modules/mip-cases/types'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { getCatalogs, superCaseGet, superCaseSave } = vi.hoisted(() => ({
  getCatalogs: vi.fn(),
  superCaseGet: vi.fn(),
  superCaseSave: vi.fn(),
}))

vi.mock('../src/modules/mip-ai/editor', () => ({ aiText: () => '' }))
vi.mock('../src/modules/mip-ai/editor-loader', () => ({ loadAiEditorDraft: vi.fn() }))
vi.mock('../src/modules/mip-cases', () => ({ superCaseModule: { get: superCaseGet, save: superCaseSave } }))
vi.mock('../src/modules/mip-opportunities', () => ({ opportunityModule: { getCatalogs } }))

type PageData = Record<string, any>
type PageDefinition = Record<string, any> & {
  data: PageData
  setData: (patch: PageData) => void
}

let definition: PageDefinition
const showModal = vi.fn()
const showToast = vi.fn()

function createPage(overrides: PageData = {}) {
  const page = Object.create(definition) as PageDefinition
  page.data = { ...structuredClone(definition.data), ...structuredClone(overrides) }
  page.setData = patch => Object.assign(page.data, patch)
  return page
}

beforeAll(async () => {
  vi.stubGlobal('wx', { showModal, showToast, navigateBack: vi.fn() })
  vi.stubGlobal('Page', (input: PageDefinition) => {
    definition = input
  })
  await import('../src/packages/member/mip-cases/editor/index')
})

beforeEach(() => {
  getCatalogs.mockReset()
  superCaseGet.mockReset()
  superCaseSave.mockReset()
  showModal.mockClear()
  showToast.mockClear()
})

function editingDetail(projects: SuperCaseDetail['projects']): SuperCaseDetail {
  return {
    id: 'case-1' as SuperCaseDetail['id'],
    projectName: '品牌升级项目',
    summary: '完成品牌定位和视觉升级',
    responsibility: '负责策略和项目统筹',
    description: '项目按计划完成并交付。',
    status: 'PUBLISHED',
    publishedAt: '2026-01-02T00:00:00.000Z',
    author: { profileRef: 'p1.test-author', nickname: '作者' },
    mine: true,
    version: 3,
    interestActive: false,
    canEdit: true,
    projects,
    media: [],
    mediaAssetIds: [],
  }
}

const publishedProject = {
  projectName: '品牌升级项目',
  summary: '完成品牌定位和视觉升级',
  startedOn: '2026-01-01',
  responsibility: '负责策略和项目统筹',
  cityLabel: '深圳',
  region: '大湾区',
  caseType: '品牌升级',
  description: '项目按计划完成并交付。',
}

async function flushAsync() {
  await new Promise(resolve => setTimeout(resolve, 0))
}

describe('MIP-2 super case editor city tag retention', () => {
  it('keeps the detail-carried cityTagId when the catalog cannot resolve the label, and still submits it', async () => {
    // catalog 缓存/时序异常：反查不到「深圳」，但服务端 detail 自带 tagId。
    getCatalogs.mockResolvedValue({ cityTags: [{ id: 'tag-sh', label: '上海' }] })
    superCaseGet.mockResolvedValue(editingDetail([
      { ...publishedProject, cityTagId: 'tag-sz-stored' },
    ]))
    superCaseSave.mockResolvedValue({ id: 'case-1', status: 'PUBLISHED', version: 4 })

    const page = createPage({ id: 'case-1' })
    await page.initialize()

    expect(page.data.state).toBe('ready')
    expect(page.data.projects[0].cityTagId).toBe('tag-sz-stored')

    await page.saveCase()
    await flushAsync()

    // 必填校验通过（未弹必填 modal），提交内容原样携带 tagId，不再被反查失败清空。
    expect(showModal).not.toHaveBeenCalled()
    expect(superCaseSave).toHaveBeenCalledTimes(1)
    // mock 的 save 直接收到页面构建的 draft（{draft} 包装发生在真实 client 内部）。
    const draft = superCaseSave.mock.calls[0][0]
    expect(draft.projects[0].cityTagId).toBe('tag-sz-stored')
    page.onUnload()
  })

  it('prefers the carried id over the catalog lookup when both resolve', async () => {
    getCatalogs.mockResolvedValue({ cityTags: [{ id: 'tag-sz-fresh', label: '深圳' }] })
    superCaseGet.mockResolvedValue(editingDetail([
      { ...publishedProject, cityTagId: 'tag-sz-stored' },
    ]))

    const page = createPage({ id: 'case-1' })
    await page.initialize()

    expect(page.data.projects[0].cityTagId).toBe('tag-sz-stored')
  })

  it('still reverse-resolves the label from the catalog for legacy details without a carried id', async () => {
    getCatalogs.mockResolvedValue({ cityTags: [{ id: 'tag-sz-fresh', label: '深圳' }] })
    superCaseGet.mockResolvedValue(editingDetail([{ ...publishedProject }]))

    const page = createPage({ id: 'case-1' })
    await page.initialize()

    expect(page.data.projects[0].cityTagId).toBe('tag-sz-fresh')
  })
})
