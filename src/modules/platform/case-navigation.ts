import { syncCustomTabBar } from '@weapp/platform/tab-bar'
import { caseRoutePrefix, isEmbeddedCase } from './case-config'

interface TabPageHandle {
  getTabBar?: () => { setData: (data: { value: string }) => void } | undefined
  setData: (data: { isEmbeddedCase: boolean }) => void
}

type NavigationOptions = WechatMiniprogram.NavigateToOption
type RedirectOptions = WechatMiniprogram.RedirectToOption
type RelaunchOptions = WechatMiniprogram.ReLaunchOption
type EmbeddedPrimarySwitchHandler = (route: string) => Promise<void> | void

let embeddedPrimarySwitchHandler: EmbeddedPrimarySwitchHandler | null = null

export function caseRoute(url: string) {
  const normalized = url.startsWith('/') ? url : `/${url}`
  return isEmbeddedCase ? `${caseRoutePrefix}${normalized}` : normalized
}

export function caseNavigateTo(options: NavigationOptions) {
  return wx.navigateTo({ ...options, url: caseRoute(options.url) })
}

export function caseRedirectTo(options: RedirectOptions) {
  return wx.redirectTo({ ...options, url: caseRoute(options.url) })
}

export function caseRelaunch(options: RelaunchOptions) {
  return wx.reLaunch({ ...options, url: caseRoute(options.url) })
}

export function registerEmbeddedPrimarySwitchHandler(handler: EmbeddedPrimarySwitchHandler) {
  embeddedPrimarySwitchHandler = handler
  return () => {
    if (embeddedPrimarySwitchHandler === handler) {
      embeddedPrimarySwitchHandler = null
    }
  }
}

export function caseSwitchPrimary(url: string) {
  const normalized = url.replace(/^\/+/, '')
  if (isEmbeddedCase && embeddedPrimarySwitchHandler) {
    return Promise.resolve(embeddedPrimarySwitchHandler(normalized))
  }
  const target = caseRoute(url)
  if (isEmbeddedCase) {
    return wx.redirectTo({ url: target })
  }
  return wx.switchTab({ url: target })
}

export function syncCaseNavigation(page: TabPageHandle, route: string) {
  page.setData({ isEmbeddedCase })
  if (!isEmbeddedCase) {
    syncCustomTabBar(page, route)
  }
}

export function leaveCase() {
  if (isEmbeddedCase) {
    return wx.reLaunch({ url: '/pages/index/index' })
  }
  return wx.navigateBack({ fail: () => wx.reLaunch({ url: '/pages/index/index' }) })
}
