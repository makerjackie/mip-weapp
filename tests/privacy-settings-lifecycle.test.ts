import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

// 行为级测试（review P1）：privacy-settings 的 data 在 Page() 注册期只求值一次，
// 微信实例化深拷贝的是注册时快照；真实持久化值必须靠 onLoad 重读，否则页面重进回显过期值。
const STORAGE_KEY = 'mip.settings.privacy.v1'
const storage = new Map<string, unknown>()
const showToast = vi.fn()

let definition: Record<string, any>
beforeAll(async () => {
  vi.stubGlobal('Page', (value: Record<string, any>) => {
    definition = value
  })
  vi.stubGlobal('wx', {
    getStorageSync: (key: string) => storage.get(key),
    setStorageSync: (key: string, value: unknown) => void storage.set(key, value),
    showToast,
  })
  await import('../src/packages/member/privacy-settings/index')
})

beforeEach(() => {
  storage.clear()
  showToast.mockClear()
})

/** 模拟微信实例化：data 是注册快照的深拷贝，页面间互不影响。 */
function page() {
  const instance = Object.create(definition)
  instance.data = structuredClone(definition.data)
  instance.setData = (patch: Record<string, unknown>) => Object.assign(instance.data, patch)
  return instance
}

function toggle(instance: ReturnType<typeof page>, key: string, value: boolean) {
  instance.onToggle({
    currentTarget: { dataset: { key } },
    detail: { value },
  })
}

describe('privacy-settings persistence lifecycle', () => {
  it('keeps the registered snapshot at defaults and hydrates the real values on onLoad', () => {
    storage.set(STORAGE_KEY, { hideFromTalentSearch: false, hideOpportunitiesFromNonPlayers: true })
    // 注册期快照必须是默认值（不受已保存偏好影响），否则后进实例会拿到过期 data。
    expect(definition.data.hideFromTalentSearch).toBe(true)
    const first = page()
    expect(first.data.hideFromTalentSearch).toBe(true)
    first.onLoad()
    expect(first.data.hideFromTalentSearch).toBe(false)
    expect(first.data.hideOpportunitiesFromNonPlayers).toBe(true)
  })

  it('re-reads persisted values on each entry so two instances never share stale state', () => {
    const first = page()
    first.onLoad()
    expect(first.data.hideFromTalentSearch).toBe(true)

    toggle(first, 'hideFromTalentSearch', false)
    expect(storage.get(STORAGE_KEY)).toMatchObject({ hideFromTalentSearch: false })

    // 第二次进入（新实例）：onLoad 读到修改后的新值，而不是第一实例的注册快照。
    const second = page()
    second.onLoad()
    expect(second.data.hideFromTalentSearch).toBe(false)
    // 先进入的实例不被第二实例的 hydration 覆盖。
    expect(first.data.hideOpportunitiesFromNonPlayers).toBe(true)
  })

  it('rolls the switch back and toasts when persistence fails', () => {
    const original = wx.setStorageSync
    ;(wx as Record<string, any>).setStorageSync = vi.fn(() => {
      throw new Error('storage full')
    })
    const instance = page()
    instance.onLoad()
    toggle(instance, 'hideOpportunitiesFromNonPlayers', false)
    ;(wx as Record<string, any>).setStorageSync = original
    expect(instance.data.hideOpportunitiesFromNonPlayers).toBe(true)
    expect(showToast).toHaveBeenCalledWith({ title: '设置暂未保存，请重试。', icon: 'none' })
  })
})
