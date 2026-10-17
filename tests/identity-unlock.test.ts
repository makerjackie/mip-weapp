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
      title: '解锁提示',
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

// 组件定义全文件只捕获一次：重复 await import 会命中 ESM 缓存，第二个 beforeAll 拿不到定义。
let definition: any

beforeAll(async () => {
  vi.stubGlobal('Component', (value: unknown) => {
    definition = value
  })
  await import('../src/components/mip-login-sheet/index')
  vi.unstubAllGlobals()
})

/** 组件方法间通过 this 互调（assertConsented），测试桩把全部方法铺进假实例。 */
function sheet(data: Record<string, unknown>, triggerEvent = vi.fn()) {
  const instance: Record<string, unknown> = { ...definition.methods, data: { ...definition.data, ...data }, triggerEvent }
  instance.setData = vi.fn((patch: Record<string, unknown>) => Object.assign(instance.data, patch))
  return instance
}

describe('login sheet subtitle override (journey-review J5-02 variant)', () => {
  it('declares an optional subtitle property that defaults to empty', () => {
    expect(definition.properties.subtitle).toEqual({ type: String, value: '' })
  })

  it('merges the returning sign-in into the single primary button behind restore-first (MIW-20)', () => {
    expect(definition.properties.restoreFirst).toEqual({ type: Boolean, value: false })
    const view = read('src/components/mip-login-sheet/index.wxml')
    // 只有一个主按钮：恢复形态先按 OpenID 恢复会话，未绑时由页面切回手机号授权形态。
    expect(view).toContain('<button\n    wx:if="{{restoreFirst}}"')
    expect(view).toContain('使用当前微信账号登录')
    expect(view).toContain('将使用你当前的微信账号恢复原有身份；未绑定手机号时会再向你授权')
    expect(view).not.toContain('使用当前微信账号重新登录')
    expect(view).not.toContain('mip-login-sheet__signin')
    // MIW-121：手机号授权形态保留原 id；open-type 随勾选置空，未勾选时不拉起原生授权。
    expect(view).toContain('wx:else\n    id="mip-login-sheet-auth"\n    open-type="{{agreed ? \'getPhoneNumber\' : \'\'}}"')
    expect(view).toContain('bind:tap="onAuthTap"')
    expect(view).toContain('bind:getphonenumber="onPhone"')
    // 恢复主按钮走 signin 事件且同样受 busy 与协议勾选门控保护。
    const showToast = vi.fn()
    vi.stubGlobal('wx', { showToast })
    const blocked = sheet({ busy: false, agreed: false })
    blocked.onSignIn()
    expect(blocked.triggerEvent).not.toHaveBeenCalled()
    expect(showToast).toHaveBeenCalledExactlyOnceWith({ title: '请先阅读并同意《服务协议》与《隐私政策》', icon: 'none' })
    const busy = sheet({ busy: true, agreed: true })
    busy.onSignIn()
    expect(busy.triggerEvent).not.toHaveBeenCalled()
    const allowed = sheet({ busy: false, agreed: true })
    allowed.onSignIn()
    expect(allowed.triggerEvent).toHaveBeenCalledExactlyOnceWith('signin')
    vi.unstubAllGlobals()
  })

  it('keeps the verbatim default copy when no subtitle is passed', () => {
    const view = read('src/components/mip-login-sheet/index.wxml')
    expect(view).toContain('<view wx:else class="mip-login-sheet__sub">将获取你微信绑定的手机号，用于确认身份\n昵称与头像无需授权，在「编辑信息」中由你主动填写</view>')
  })

  it('renders the passed subtitle in place of the default copy', () => {
    const view = read('src/components/mip-login-sheet/index.wxml')
    expect(view).toContain('<view wx:if="{{subtitle}}" class="mip-login-sheet__sub">{{subtitle}}</view>')
  })

  it('keeps both the modal scrim and sheet above the custom TabBar', () => {
    const styles = read('src/components/mip-login-sheet/index.wxss')
    const tabBarStyles = read('src/custom-tab-bar/index.wxss')
    const layer = (source: string, selector: string) => {
      const rule = source.split(`${selector} {`)[1]?.split('}')[0] || ''
      return Number(rule.match(/z-index:\s*(\d+)/)?.[1])
    }
    const scrim = layer(styles, '.mip-login-sheet__scrim')
    const sheet = layer(styles, '.mip-login-sheet')
    expect(scrim).toBeGreaterThan(layer(tabBarStyles, '.tab-bar'))
    expect(sheet).toBeGreaterThan(scrim)
  })

  it('makes cancellation an accessible full-width touch target and keeps busy submissions protected', () => {
    const view = read('src/components/mip-login-sheet/index.wxml')
    const dismiss = view.match(/<view[^>]*id="mip-login-sheet-dismiss"[^>]*>/)?.[0]
    expect(dismiss).toContain('aria-role="button"')
    expect(dismiss).toContain('aria-disabled="{{busy}}"')
    expect(dismiss).toContain('bind:tap="onDismiss"')
    const rule = read('src/components/mip-login-sheet/index.wxss').split('.mip-login-sheet__ghost {')[1]?.split('}')[0]
    expect(rule).toContain('min-height: 88rpx')
    const busySheet = sheet({ busy: true })
    busySheet.onDismiss()
    expect(busySheet.triggerEvent).not.toHaveBeenCalled()
    const idleSheet = sheet({ busy: false })
    idleSheet.onDismiss()
    expect(idleSheet.triggerEvent).toHaveBeenCalledExactlyOnceWith('dismiss')
  })
})

describe('login sheet agreement consent gate (MIW-121)', () => {
  it('renders a consent row between the subtitle and the primary button with tappable document links', () => {
    const view = read('src/components/mip-login-sheet/index.wxml')
    expect(view).toContain('<checkbox-group class="mip-login-sheet__consent" bindchange="onConsentChange">')
    expect(view).toContain('我已阅读并同意')
    expect(view).toContain('catch:tap="openUserAgreement"')
    expect(view).toContain('catch:tap="openPrivacyPolicy"')
    expect(view).toContain('aria-role="checkbox"')
    // 勾选行位于副标题块之后、主按钮之前。
    expect(view.indexOf('mip-login-sheet__consent')).toBeGreaterThan(view.indexOf('mip-login-sheet__sub'))
    expect(view.indexOf('<checkbox-group')).toBeLessThan(view.indexOf('<button'))
  })

  it('tracks the checkbox state from the checkbox-group detail', () => {
    const consented = sheet({ agreed: false })
    consented.onConsentChange({ detail: { value: ['agreed'] } })
    consented.onConsentChange({ detail: { value: [] } })
    consented.onConsentChange({ detail: undefined })
    expect(consented.setData).toHaveBeenCalledTimes(3)
    expect(consented.setData).toHaveBeenNthCalledWith(1, { agreed: true })
    expect(consented.setData).toHaveBeenNthCalledWith(2, { agreed: false })
    expect(consented.setData).toHaveBeenNthCalledWith(3, { agreed: false })
  })

  it('blocks phone and sign-in events until consented, with a toast instead of the native dialog', () => {
    const showToast = vi.fn()
    vi.stubGlobal('wx', { showToast, navigateTo: vi.fn() })
    const blockedPhone = sheet({ agreed: false })
    const detail = { code: 'phone-code-1' }
    blockedPhone.onPhone({ detail })
    expect(blockedPhone.triggerEvent).not.toHaveBeenCalled()
    expect(showToast).toHaveBeenCalledTimes(1)
    const blockedTap = sheet({ agreed: false })
    blockedTap.onAuthTap()
    expect(blockedTap.triggerEvent).not.toHaveBeenCalled()
    expect(showToast).toHaveBeenCalledTimes(2)
    const allowedPhone = sheet({ agreed: true })
    allowedPhone.onPhone({ detail })
    expect(allowedPhone.triggerEvent).toHaveBeenCalledExactlyOnceWith('phone', detail)
    vi.unstubAllGlobals()
  })

  it('opens the two agreement documents without closing the sheet', () => {
    const navigateTo = vi.fn()
    vi.stubGlobal('wx', { navigateTo })
    sheet({ userAgreementPath: definition.data.userAgreementPath }).openUserAgreement()
    sheet({ privacyPolicyPath: definition.data.privacyPolicyPath }).openPrivacyPolicy()
    expect(navigateTo).toHaveBeenNthCalledWith(1, { url: '/packages/member/user-agreement/index' })
    expect(navigateTo).toHaveBeenNthCalledWith(2, { url: '/packages/member/privacy-policy/index' })
    vi.unstubAllGlobals()
  })
})
