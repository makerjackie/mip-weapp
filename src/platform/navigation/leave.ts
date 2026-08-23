export function canNavigateBack() {
  return getCurrentPages().length > 1
}

export function leaveSecondaryPage(tabUrl: string, fallbackTabUrl = '/pages/index/index') {
  if (canNavigateBack()) {
    wx.navigateBack()
    return
  }
  const url = tabUrl.startsWith('/') ? tabUrl : `/${tabUrl}`
  wx.switchTab({
    url,
    fail: () => wx.switchTab({ url: fallbackTabUrl }),
  })
}
