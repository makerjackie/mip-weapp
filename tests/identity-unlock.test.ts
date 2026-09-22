import fs from 'node:fs'
import path from 'node:path'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { showIdentityUnlockModal } from '../src/shared/identity-unlock'

const root = path.resolve(import.meta.dirname, '..')

function read(relativePath: string) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

describe('identity unlock modal (journey-review J2-04, 2026-09-21 拍板)', () => {
  it('shows the native wx.showModal with the verbatim unlock copy', async () => {
    const showModal = vi.fn().mockResolvedValue({ confirm: true, cancel: false, errMsg: 'showModal:ok' })
    vi.stubGlobal('wx', { showModal })

    await showIdentityUnlockModal()

    expect(showModal).toHaveBeenCalledExactlyOnceWith({
      title: '',
      content: '报名并签到任意一场MIP活动，可解锁该功能',
      confirmText: '确定',
      cancelText: '取消',
      showCancel: true,
    })
    vi.unstubAllGlobals()
  })

  it('resolves the raw result so confirm and cancel behave identically', async () => {
    const raw = { confirm: false, cancel: true, errMsg: 'showModal:ok' }
    const showModal = vi.fn().mockResolvedValue(raw)
    vi.stubGlobal('wx', { showModal })

    await expect(showIdentityUnlockModal()).resolves.toBe(raw)

    vi.unstubAllGlobals()
  })

  it('keeps the native form: no navigation and no custom button color', () => {
    const source = read('src/shared/identity-unlock.ts')
    expect(source).not.toMatch(/navigateTo|redirectTo|reLaunch|switchTab|navigateBack/)
    expect(source).not.toContain('confirmColor')
  })
})

describe('login sheet subtitle override (journey-review J5-02 variant)', () => {
  let definition: any

  beforeAll(async () => {
    vi.stubGlobal('Component', (value: unknown) => {
      definition = value
    })
    await import('../src/components/mip-login-sheet/index')
    vi.unstubAllGlobals()
  })

  it('declares an optional subtitle property that defaults to empty', () => {
    expect(definition.properties.subtitle).toEqual({ type: String, value: '' })
  })

  it('keeps the verbatim default copy when no subtitle is passed', () => {
    const view = read('src/components/mip-login-sheet/index.wxml')
    expect(view).toContain('<view wx:else class="mip-login-sheet__sub">将获取你微信绑定的手机号，用于确认身份\n昵称与头像无需授权，在「编辑信息」中由你主动填写</view>')
  })

  it('renders the passed subtitle in place of the default copy', () => {
    const view = read('src/components/mip-login-sheet/index.wxml')
    expect(view).toContain('<view wx:if="{{subtitle}}" class="mip-login-sheet__sub">{{subtitle}}</view>')
  })
})
