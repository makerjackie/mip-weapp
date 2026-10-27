import { beforeAll, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ snapshot: vi.fn(), tags: vi.fn() }))
vi.mock('../src/modules/mip-identity/client', () => ({ mipIdentityModule: { loadSnapshot: mocks.snapshot, listProfileTags: mocks.tags } }))
vi.mock('../src/modules/mip-ai/editor-loader', () => ({ loadAiEditorDraft: vi.fn() }))
vi.mock('../src/modules/mip-media/client', () => ({ mipMediaModule: {} }))
vi.mock('../src/platform/navigation/client', () => ({ leaveSecondaryPage: vi.fn() }))
vi.mock('../src/platform/storage/component-media', () => ({ clearPageMedia: vi.fn(), updatePageMedia: vi.fn() }))
let definition: any
beforeAll(async () => {
  vi.stubGlobal('Page', (value: unknown) => {
    definition = value
  })
  await import('../src/packages/member/mip-profile/index')
})
it('loads popular tags from the service and keeps quick picks consistent with the full single-select picker', async () => {
  mocks.snapshot.mockResolvedValue({ profile: { primaryIndustryTagId: 'retained', primaryIndustryLabel: '停用行业', nickname: '测试', version: 1 } })
  mocks.tags.mockResolvedValue([
    { id: 'group', kind: 'INDUSTRY', label: '科技', selectable: false },
    { id: 'ai', kind: 'INDUSTRY', parentId: 'group', label: '人工智能', selectable: true, popular: true },
    { id: 'software', kind: 'INDUSTRY', parentId: 'group', label: '软件', selectable: true, popular: false },
  ])
  const p = Object.create(definition)
  p.data = structuredClone(definition.data)
  p.setData = (patch: unknown) => Object.assign(p.data, patch)
  await p.loadProfile()
  expect(p.data.state).toBe('ready')
  expect(p.data.popularIndustries).toEqual([{ id: 'ai', label: '人工智能' }])
  expect(p.data.selectedIndustryIds).toEqual(['retained'])
  p.choosePopularIndustry({ currentTarget: { dataset: { id: 'ai' } } })
  expect(p.data.selectedIndustryIds).toEqual(['ai'])
  expect(p.data.industryOptions[p.data.industryIndex].id).toBe('ai')
  p.choosePopularIndustry({ currentTarget: { dataset: { id: 'injected' } } })
  expect(p.data.selectedIndustryIds).toEqual(['ai'])
  p.data.draftIndustryIds = ['software']
  p.confirmIndustryPicker()
  expect(p.data.selectedIndustryIds).toEqual(['software'])
  expect(p.data.industryOptions[p.data.industryIndex].id).toBe('software')
})
