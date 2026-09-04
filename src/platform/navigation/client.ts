import { syncCustomTabBar } from './tab-bar'

export { canNavigateBack, leaveSecondaryPage } from './leave'

interface TabPageHandle {
  getTabBar?: () => { setData: (data: { value: string, selected: number }) => void } | undefined
}

type NavigationOptions = WechatMiniprogram.NavigateToOption
type RedirectOptions = WechatMiniprogram.RedirectToOption

function caseRoute(url: string) {
  return url.startsWith('/') ? url : `/${url}`
}

export function caseNavigateTo(options: NavigationOptions) {
  return wx.navigateTo({ ...options, url: caseRoute(options.url) })
}

export function caseRedirectTo(options: RedirectOptions) {
  return wx.redirectTo({ ...options, url: caseRoute(options.url) })
}

export function caseSwitchPrimary(url: string) {
  return wx.switchTab({ url: caseRoute(url) })
}

export function syncCaseNavigation(page: TabPageHandle, route: string) {
  syncCustomTabBar(page, route)
}
