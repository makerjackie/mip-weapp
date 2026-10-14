export function canNavigateBack() {
  return getCurrentPages().length > 1
}

// BUG-03（交互审计 2026-10-12）：返回转场（约 300ms）完成前页面栈未变，
// 双击会连退两级；短窗口内只放行第一次。navigateBack 失败时清窗允许立即重试。
const LEAVE_DEDUPE_WINDOW_MS = 600

let lastLeaveAt = 0

export function leaveSecondaryPage(tabUrl: string, fallbackTabUrl = '/pages/events/index') {
  const now = Date.now()
  if (now - lastLeaveAt < LEAVE_DEDUPE_WINDOW_MS) {
    return
  }
  lastLeaveAt = now
  if (canNavigateBack()) {
    wx.navigateBack({
      fail: () => {
        lastLeaveAt = 0
      },
    })
    return
  }
  const url = tabUrl.startsWith('/') ? tabUrl : `/${tabUrl}`
  wx.switchTab({
    url,
    fail: () => wx.switchTab({ url: fallbackTabUrl }),
  })
}
