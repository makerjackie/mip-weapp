import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

// 名片编辑即名片发布（figma 1732_20291 无独立展示开关）：保存按「填了即上卡」
// 推导 cardContacts 可见性，更换头像随保存绑定 AVATAR 资产。
const identity = vi.hoisted(() => ({
  getProfile: vi.fn(),
  getMyProfileCardCode: vi.fn(),
  updateCard: vi.fn(),
  rebindWechatPhone: vi.fn(),
}))
const media = vi.hoisted(() => ({
  uploadImageFromPath: vi.fn(),
}))
vi.mock('../src/modules/mip-identity/client', () => ({ mipIdentityModule: identity }))
vi.mock(import('../src/modules/mip-identity'), async importOriginal => ({
  ...(await importOriginal<object>()),
  MAX_PROFILE_ORGANIZATIONS: 5,
}))
vi.mock('../src/modules/mip-media/client', () => ({ mipMediaModule: media }))

type Data = Record<string, unknown>
interface Definition { data: Data, [key: string]: unknown }
let definition: Definition
beforeAll(async () => {
  vi.stubGlobal('Page', (value: Definition) => {
    definition = value
  })
  vi.stubGlobal('wx', { showToast: vi.fn(), navigateBack: vi.fn() })
  await import('../src/packages/member/mip-card-edit/index')
})

function createPage(patch: Data = {}) {
  const value = Object.create(definition) as Definition & { setData: (patch: Data) => void }
  value.data = structuredClone(definition.data)
  value.setData = key => Object.assign(value.data, key)
  Object.assign(value.data, patch)
  return value
}

// 锁窗口用例断言绝对调用次数,每个用例前清空 mock 记录。
beforeEach(() => {
  vi.clearAllMocks()
})

describe('card edit save publishes filled contacts', () => {
  it('derives cardContacts visibility from value presence and passes the chosen avatar', async () => {
    identity.updateCard.mockResolvedValue({ profile: { version: 8, visibility: { cardContacts: { phone: true, wechat: true, email: true, address: false } } } })
    const page = createPage({
      profileVersion: 7,
      phoneBound: true,
      phoneMasked: '138****5678',
      wechat: 'DYM888',
      email: 'dym@example.com',
      address: '  ',
      avatarAssetId: 'asset-1',
    })
    await Reflect.apply(page.save as (...args: unknown[]) => Promise<void>, page, [])
    expect(identity.updateCard).toHaveBeenCalledWith(expect.objectContaining({
      expectedVersion: 7,
      avatarAssetId: 'asset-1',
      wechat: 'DYM888',
      email: 'dym@example.com',
      visibility: { cardContacts: { phone: true, wechat: true, email: true, address: false } },
    }))
    expect(page.data).toMatchObject({ profileVersion: 8, visibilityPhone: true, visibilityWechat: true, visibilityEmail: true, visibilityAddress: false })
  })

  it('keeps the avatar unchanged when none was chosen in this session', async () => {
    identity.updateCard.mockResolvedValue({ profile: {} })
    const page = createPage({ profileVersion: 9, wechat: '', email: '', address: '', avatarAssetId: '' })
    await Reflect.apply(page.save as (...args: unknown[]) => Promise<void>, page, [])
    expect(identity.updateCard).toHaveBeenCalledWith(expect.objectContaining({
      avatarAssetId: undefined,
      visibility: { cardContacts: { phone: false, wechat: false, email: false, address: false } },
    }))
  })
})

describe('card edit avatar picker', () => {
  it('uploads the chosen avatar and binds the asset for the next save', async () => {
    media.uploadImageFromPath.mockResolvedValue({ assetId: 'asset-2', imageUrl: 'https://cdn/a.png' })
    const page = createPage({})
    await Reflect.apply(page.chooseAvatar as (...args: unknown[]) => Promise<void>, page, [{ detail: { avatarUrl: 'wxfile://tmp/a.jpg' } }])
    expect(media.uploadImageFromPath).toHaveBeenCalledWith('AVATAR', 'wxfile://tmp/a.jpg')
    expect(page.data).toMatchObject({ avatarAssetId: 'asset-2', formAvatarUrl: 'https://cdn/a.png', previewAvatarUrl: 'https://cdn/a.png', avatarUploading: false })
  })

  it('surfaces upload failures and clears the uploading flag', async () => {
    media.uploadImageFromPath.mockRejectedValue(new Error('UPLOAD_FAILED'))
    const page = createPage({})
    await Reflect.apply(page.chooseAvatar as (...args: unknown[]) => Promise<void>, page, [{ detail: { avatarUrl: 'wxfile://tmp/b.jpg' } }])
    expect(page.data).toMatchObject({ message: 'UPLOAD_FAILED', avatarUploading: false, avatarAssetId: '' })
  })
})

// BUG-08:保存成功后有 300ms「toast 展示再 navigateBack」窗口,期间保存锁必须保持,
// 否则按钮 loading 已解除、页面仍可见,再点「保存」会发起第二次真实 updateCard。
describe('card edit save lock during the delayed back window', () => {
  it('keeps saving locked after success until the pending back navigation is settled', async () => {
    identity.updateCard.mockResolvedValue({ profile: { version: 8, visibility: { cardContacts: { phone: false, wechat: false, email: false, address: false } } } })
    const page = createPage({ profileVersion: 7 })
    await Reflect.apply(page.save as (...args: unknown[]) => Promise<void>, page, [])
    expect(identity.updateCard).toHaveBeenCalledTimes(1)
    // 300ms 窗口内:锁保持,loading 不解除。
    expect(page.data.saving).toBe(true)
    // 窗口内第二次点「保存」:被锁拦下,不再发起第二次真实保存。
    await Reflect.apply(page.save as (...args: unknown[]) => Promise<void>, page, [])
    expect(identity.updateCard).toHaveBeenCalledTimes(1)
    // 待返回定时器被 onHide 清掉而页面未出栈时放开锁,页面回来后按钮不会永久 loading。
    page.onHide()
    expect(page.data.saving).toBe(false)
  })

  it('releases the save lock when the save request fails', async () => {
    identity.updateCard.mockRejectedValue(new Error('VERSION_CONFLICT'))
    const page = createPage({ profileVersion: 7 })
    await Reflect.apply(page.save as (...args: unknown[]) => Promise<void>, page, [])
    expect(identity.updateCard).toHaveBeenCalledTimes(1)
    expect(page.data.saving).toBe(false)
    expect(page.data.message).toBe('VERSION_CONFLICT')
  })
})
