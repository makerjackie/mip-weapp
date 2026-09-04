function toFiniteNumber(value: unknown) {
  const number = Number(value)
  return Number.isFinite(number) ? number : 0
}

/** Returns the status-bar inset used by the shared top-safe-area component. */
export function getCustomNavigationStatusBarHeight() {
  const windowInfo = wx.getWindowInfo()
  return Math.ceil(Math.max(
    toFiniteNumber(windowInfo.statusBarHeight),
    toFiniteNumber(windowInfo.safeArea?.top),
  ))
}
