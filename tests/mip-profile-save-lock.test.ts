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
  value.data = { ...structuredClone(definition.data), avatarAssetId: 'avatar', selectedIndustryIds: ['industry'], careerIdentityKey: 'STUDENT', headline: '一句话介绍' }
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
      industryCatalogAvailable: true,
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

describe('profile retains historical industries', () => {
  const snapshot = {
    profile: {
      version: 8,
      avatarAssetId: 'avatar',
      nickname: '测试用户',
      realName: '',
      gender: 'UNKNOWN',
      careerIdentityKey: 'STUDENT',
      identityStatus: '',
      headline: '一句话介绍',
      introduction: '',
      companies: [],
      organizations: [],
      visibility: {},
      abilityTagIds: [],
      primaryIndustryTagId: 'retained',
      primaryIndustryLabel: '电子通讯',
    },
  }
  const activeTags = [
    { id: 'group', kind: 'INDUSTRY', label: '互联网', key: 'internet', selectable: false },
    { id: 'ai', kind: 'INDUSTRY', label: '人工智能', key: 'ai', parentId: 'group', selectable: true, popular: true },
  ]
  const invoke = (page: Definition, method: string, ...args: unknown[]) => Reflect.apply(page[method] as (...args: unknown[]) => unknown, page, args)

  it('shows a stored disabled value without making it newly selectable, and saves it after editing another field', async () => {
    identity.loadSnapshot.mockResolvedValue(snapshot)
    identity.listProfileTags.mockResolvedValue(activeTags)
    identity.saveProfile.mockResolvedValue(savedProfileSnapshot())
    const page = createPage()
    await invoke(page, 'loadProfile')
    expect(page.data.state).toBe('ready')
    expect(page.data.industryOptions).toEqual([
      { id: '', label: '未选择' },
      { id: 'ai', label: '互联网 · 人工智能' },
      { id: 'retained', label: '电子通讯（已停用）' },
    ])
    expect(JSON.stringify(page.data.industryGroups)).not.toContain('retained')
    invoke(page, 'toggleCatalog')
    invoke(page, 'confirmIndustryPicker')
    invoke(page, 'updateText', { currentTarget: { dataset: { field: 'nickname' } }, detail: { value: '新昵称' } })
    await invoke(page, 'saveProfile')
    expect(identity.saveProfile).toHaveBeenCalledWith(expect.objectContaining({ nickname: '新昵称', primaryIndustryTagId: 'retained' }))
    invoke(page, 'onHide')
  })

  it('requires an industry after clearing, or saves an active replacement', async () => {
    for (const selection of [[], ['ai']]) {
      identity.saveProfile.mockClear()
      identity.loadSnapshot.mockResolvedValue(snapshot)
      identity.listProfileTags.mockResolvedValue(activeTags)
      identity.saveProfile.mockResolvedValue(savedProfileSnapshot())
      const page = createPage()
      await invoke(page, 'loadProfile')
      invoke(page, 'toggleCatalog')
      invoke(page, 'changeIndustry', { detail: { selectedIds: selection } })
      invoke(page, 'confirmIndustryPicker')
      await invoke(page, 'saveProfile')
      if (selection.length) {
        expect(identity.saveProfile).toHaveBeenLastCalledWith(expect.objectContaining({ primaryIndustryTagId: selection[0] }))
      }
      else { expect(identity.saveProfile).not.toHaveBeenCalled() }
      invoke(page, 'onHide')
    }
  })

  it('keeps the existing industry and other fields editable when the optional catalog request fails', async () => {
    identity.loadSnapshot.mockResolvedValue(snapshot)
    identity.listProfileTags.mockRejectedValue(new Error('目录不可用'))
    identity.saveProfile.mockResolvedValue(savedProfileSnapshot())
    const page = createPage()
    await invoke(page, 'loadProfile')
    expect(page.data.state).toBe('ready')
    expect(page.data.message).toContain('已保留原行业')
    invoke(page, 'toggleCatalog')
    expect(page.data.industryCatalogExpanded).toBe(false)
    await invoke(page, 'saveProfile')
    expect(identity.saveProfile).toHaveBeenCalledWith(expect.objectContaining({ primaryIndustryTagId: 'retained' }))
    invoke(page, 'onHide')
  })
})
