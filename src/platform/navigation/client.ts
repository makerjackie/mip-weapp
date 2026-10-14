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

// BUG-02（交互审计 2026-10-12）：双击窗口内同一 URL 的重复入栈去重。
// 微信 navigateTo/redirectTo 不排重，转场动画期间旧页仍可收到第二次 tap；
// 仅对「同 URL + 短窗口」生效，不拦截不同目标的连续导航。失败时清窗允许立即重试。
const NAVIGATION_DEDUPE_WINDOW_MS = 600

let lastNavigateUrl = ''
let lastNavigateAt = 0

function shouldDeduplicateNavigation(url: string) {
  const now = Date.now()
  if (url === lastNavigateUrl && now - lastNavigateAt < NAVIGATION_DEDUPE_WINDOW_MS) {
    return true
  }
  lastNavigateUrl = url
  lastNavigateAt = now
  return false
}

function resetNavigationDedupe(url: string) {
  if (lastNavigateUrl === url) {
    lastNavigateAt = 0
  }
}

export function caseNavigateTo(options: NavigationOptions): Promise<void> {
  const url = caseRoute(options.url)
  if (shouldDeduplicateNavigation(url)) {
    return Promise.resolve()
  }
  return new Promise((resolve) => {
    wx.navigateTo({
      ...options,
      url,
      fail: (error) => {
        resetNavigationDedupe(url)
        options.fail?.(error)
      },
      complete: (result) => {
        options.complete?.(result)
        resolve()
      },
    })
  })
}

export function caseRedirectTo(options: RedirectOptions): Promise<void> {
  const url = caseRoute(options.url)
  if (shouldDeduplicateNavigation(url)) {
    return Promise.resolve()
  }
  return new Promise((resolve) => {
    wx.redirectTo({
      ...options,
      url,
      fail: (error) => {
        resetNavigationDedupe(url)
        options.fail?.(error)
      },
      complete: (result) => {
        options.complete?.(result)
        resolve()
      },
    })
  })
}

export function caseSwitchPrimary(url: string) {
  return wx.switchTab({ url: caseRoute(url) })
}

// app.json tabBar 页清单（custom 自绘 tabbar，与 src/app.json 同步维护）。
// tab 页只能 switchTab，且微信不支持带 query 参数跳转。
const PRIMARY_TAB_ROUTES = Object.freeze(new Set([
  '/pages/events/index',
  '/pages/events/index',
  '/pages/opportunities/index',
  '/pages/profile/index',
]))

// MIW-84：按任务配置的点击动作目标页分流——tab 页走主 Tab，普通页入栈。
// 目标路径来自后台白名单（config/runtime-pages.json），不带 query。
export function caseOpenRoute(url: string): Promise<void> {
  const route = caseRoute(url)
  if (PRIMARY_TAB_ROUTES.has(route)) {
    caseSwitchPrimary(route)
    return Promise.resolve()
  }
  return caseNavigateTo({ url })
}

export function syncCaseNavigation(page: TabPageHandle, route: string) {
  syncCustomTabBar(page, route)
}
