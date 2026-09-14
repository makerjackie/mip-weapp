import { beforeAll, beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ listCategories: vi.fn(), listContents: vi.fn() }))
vi.mock('../src/modules/mip-knowledge/client', () => ({ mipKnowledgeModule: mocks }))
let definition: { data: Record<string, unknown> } & Record<string, any>
beforeAll(async () => {
  vi.stubGlobal('Page', (value: typeof definition) => {
    definition = value
  })
  await import('../src/packages/member/mip-knowledge/index')
  vi.unstubAllGlobals()
})
beforeEach(() => {
  vi.resetAllMocks()
  mocks.listContents.mockResolvedValue({ items: [{ id: 'content-1', title: '内容', contentType: 'ARTICLE', accessType: 'FREE' }] })
})
function page() {
  return Object.assign(Object.create(definition), {
    data: structuredClone(definition.data),
    setData(patch: Record<string, unknown>) { Object.assign(this.data, patch) },
  })
}
it('shows non-empty content before optional categories finish', async () => {
  let finish!: (value: unknown) => void
  mocks.listCategories.mockImplementationOnce(() => new Promise((resolve) => {
    finish = resolve
  }))
  const p = page()
  const loading = p.loadFiltersAndContents()
  await vi.waitFor(() => expect(p.data.state).toBe('ready'))
  expect(p.data.items[0].title).toBe('内容')
  finish([])
  await loading
})
it('keeps content usable when categories fail and lets categories retry independently', async () => {
  mocks.listCategories.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce([])
  const p = page()
  await p.loadFiltersAndContents()
  expect(p.data.state).toBe('ready')
  expect(p.data.catalogMessage).not.toBe('')
  await p.retryCategories()
  expect(p.data.catalogMessage).toBe('')
  expect(mocks.listContents).toHaveBeenCalledOnce()
})
it('ignores both pending responses after leaving the page', async () => {
  let finish!: (value: unknown) => void
  mocks.listCategories.mockImplementationOnce(() => new Promise((resolve) => {
    finish = resolve
  }))
  const p = page()
  const loading = p.loadFiltersAndContents()
  p.onUnload()
  finish([{ id: 'stale' }])
  await loading
  expect(p.data.items).toEqual([])
  expect(p.data.categories).toEqual([])
})
