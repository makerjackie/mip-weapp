import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

// BUG-08:保存成功后有 300ms「toast 展示再 navigateBack」窗口,期间保存锁必须保持,
// 否则按钮 loading 已解除、页面仍可见,再点「保存」会发起第二次真实 saveProfile。

const identity = vi.hoisted(() => ({
  loadSnapshot: vi.fn(),
  listProfileTags: vi.fn(),
  saveProfile: vi.fn(),
}))
const media = vi.hoisted(() => ({ uploadImageFromPath: vi.fn() }))
const aiEditor = vi.hoisted(() => ({ aiOrganizations: vi.fn(() => []), aiText: vi.fn(() => '') }))
const aiLoader = vi.hoisted(() => ({ loadAiEditorDraft: vi.fn() }))

vi.mock('../src/modules/mip-identity/client', () => ({ mipIdentityModule: identity }))
vi.mock('../src/modules/mip-media/client', () => ({ mipMediaModule: media }))
vi.mock('../src/modules/mip-ai/editor', () => aiEditor)
vi.mock('../src/modules/mip-ai/editor-loader', () => aiLoader)

type Data = Record<string, unknown>
interface Definition { data: Data, [key: string]: unknown }
let definition: Definition
beforeAll(async () => {
  vi.stubGlobal('Page', (value: Definition) => {
    definition = value
  })
  vi.stubGlobal('wx', {
    showToast: vi.fn(),
    navigateBack: vi.fn(),
    redirectTo: vi.fn(),
    switchTab: vi.fn(),
  })
  await import('../src/packages/member/mip-profile/index')
})

function createPage(patch: Data = {}) {
  const value = Object.create(definition) as Definition & { setData: (patch: Data) => void }
  value.data = structuredClone(definition.data)
  value.setData = key => Object.assign(value.data, key)
  Object.assign(value.data, patch)
  return value
}

function savedProfileSnapshot() {
  return {
    profile: {
      version: 11,
      avatarAssetId: 'asset-1',
      avatarUrl: 'https://cdn/a.png',
      visibility: { cardContacts: { phone: false } },
    },
  }
}

// 用例断言绝对调用次数,每个用例前清空 mock 记录。
beforeEach(() => {
  vi.clearAllMocks()
})

describe('profile save lock during the delayed back window (BUG-08)', () => {
  it('keeps saving locked after success so a second tap cannot submit twice', async () => {
    identity.saveProfile.mockResolvedValue(savedProfileSnapshot())
    const page = createPage({ nickname: '新昵称', profileVersion: 10, profileVisibility: {}, token: '' })
    await Reflect.apply(page.saveProfile as (...args: unknown[]) => Promise<void>, page, [])
    expect(identity.saveProfile).toHaveBeenCalledTimes(1)
    // 300ms 返回窗口内:锁保持,loading 不解除。
    expect(page.data.saving).toBe(true)
    // 窗口内第二次点「保存」:被锁拦下,不再发起第二次真实保存。
    await Reflect.apply(page.saveProfile as (...args: unknown[]) => Promise<void>, page, [])
    expect(identity.saveProfile).toHaveBeenCalledTimes(1)
    // 待返回定时器被 onHide 清掉而页面未出栈时放开锁,页面回来后按钮不会永久 loading。
    page.onHide()
    expect(page.data.saving).toBe(false)
  })

  it('releases the save lock when the save request fails', async () => {
    identity.saveProfile.mockRejectedValue(new Error('VERSION_CONFLICT'))
    const page = createPage({ nickname: '新昵称', profileVersion: 10, profileVisibility: {}, token: '' })
    await Reflect.apply(page.saveProfile as (...args: unknown[]) => Promise<void>, page, [])
    expect(identity.saveProfile).toHaveBeenCalledTimes(1)
    expect(page.data.saving).toBe(false)
    expect(page.data.message).toBe('VERSION_CONFLICT')
  })
})

describe('profile industry draft interaction', () => {
  it('commits only on confirm and discards an unconfirmed choice on reopen', () => {
    const page = createPage({
      industryOptions: [{ id: '', label: '未选择' }, { id: 'ai', label: '人工智能' }, { id: 'retail', label: '零售' }],
      selectedIndustryIds: ['ai'],
      industryIndex: 1,
    })
    const invoke = (method: string, ...args: unknown[]) => Reflect.apply(page[method] as (...args: unknown[]) => void, page, args)
    invoke('toggleCatalog')
    invoke('changeIndustry', { detail: { selectedIds: ['retail'] } })
    expect(page.data.selectedIndustryIds).toEqual(['ai'])
    expect(page.data.industryCatalogExpanded).toBe(true)
    invoke('closeIndustryPicker')
    invoke('toggleCatalog')
    expect(page.data.draftIndustryIds).toEqual(['ai'])
    invoke('changeIndustry', { detail: { selectedIds: ['retail'] } })
    invoke('confirmIndustryPicker')
    expect(page.data.selectedIndustryIds).toEqual(['retail'])
    expect(page.data.industryIndex).toBe(2)
    invoke('toggleCatalog')
    invoke('clearIndustryDraft')
    expect(page.data.selectedIndustryIds).toEqual(['retail'])
    invoke('confirmIndustryPicker')
    expect(page.data.selectedIndustryIds).toEqual([])
    expect(page.data.industryIndex).toBe(0)
  })
})
