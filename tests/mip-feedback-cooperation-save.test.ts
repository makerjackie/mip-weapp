import { afterEach, beforeAll, expect, it, vi } from 'vitest'

const save = vi.hoisted(() => vi.fn())
vi.mock('../src/modules/mip-cooperation', () => ({ cooperationModule: { save } }))
vi.mock('../src/modules/mip-ai/editor-loader', () => ({ loadAiEditorDraft: vi.fn() }))
vi.mock('../src/platform/navigation/client', () => ({ caseNavigateTo: vi.fn() }))
let definition: any
beforeAll(async () => {
  vi.stubGlobal('Page', (value: unknown) => {
    definition = value
  })
  vi.stubGlobal('wx', { showToast: vi.fn(), navigateBack: vi.fn(), disableAlertBeforeUnload: vi.fn() })
  await import('../src/packages/member/mip-cooperation/editor/index')
})
afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
  save.mockReset()
})
it('publishes an explicit save but leaves automatic exit drafts private', async () => {
  vi.useFakeTimers()
  const p = Object.create(definition)
  p.data = structuredClone(definition.data)
  p.setData = (patch: unknown) => Object.assign(p.data, patch)
  p.buildDraftPayload = () => ({ roleKey: 'strategist', positioning: '测试定位', targetSummary: '测试目标' })
  save.mockResolvedValue({ id: 'saved-card', version: 2, status: 'PUBLISHED' })
  await p.save()
  expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ publish: true }))
  expect(p.data).toMatchObject({ id: 'saved-card', version: 2, saving: false })
  p.clearNavigationTimer()
  await p.saveDraftOnExit()
  expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ publish: false }))
})
