import type { MipGlobalAccessTarget } from './global-access'
import { mipIdentityModule } from './client'
import { createMipGlobalAccessGuard } from './global-access'

function currentPage(): MipGlobalAccessTarget | undefined {
  const page = getCurrentPages().at(-1) as unknown as {
    route?: string
    options?: Record<string, unknown>
  } | undefined
  if (!page?.route) {
    return undefined
  }
  const query = Object.fromEntries(
    Object.entries(page.options || {}).map(([key, value]) => [key, String(value)]),
  )
  return { path: page.route, query }
}

export const mipGlobalAccessGuard = createMipGlobalAccessGuard(mipIdentityModule, {
  currentPage,
  reLaunch: url => wx.reLaunch({ url }),
  canNavigateBack: () => getCurrentPages().length > 1,
  navigateBack: () => wx.navigateBack(),
})

export function exitMipMiniProgram() {
  wx.exitMiniProgram({
    fail: () => wx.showToast({ title: '请先完成身份确认', icon: 'none' }),
  })
}
