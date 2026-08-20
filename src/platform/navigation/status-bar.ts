function toFiniteNumber(value: unknown) {
  const number = Number(value)
  return Number.isFinite(number) ? number : 0
}

/**
 * Returns only the status-bar inset for lightweight custom-navigation chrome.
 *
 * Use this when content deliberately stays away from the upper-right capsule,
 * Full-width or
 * capsule-adjacent chrome must use getCustomNavigationContentTop instead.
 */
export function getCustomNavigationStatusBarHeight() {
  return Math.ceil(toFiniteNumber(wx.getWindowInfo().statusBarHeight))
}

/**
 * Returns the first safe y-coordinate below WeChat's status bar and capsule.
 *
 * Custom-navigation pages cannot rely on CSS safe-area insets alone: on some
 * devices the top inset is zero even though the capsule still occupies the
 * upper-right corner. Read the real runtime geometry so reusable page chrome
 * never overlaps WeChat's native controls.
 */
export function getCustomNavigationContentTop() {
  const windowInfo = wx.getWindowInfo()
  const statusBarHeight = toFiniteNumber(windowInfo.statusBarHeight)

  try {
    const menuButton = wx.getMenuButtonBoundingClientRect()
    const menuTop = toFiniteNumber(menuButton.top)
    const menuBottom = toFiniteNumber(menuButton.bottom)
    if (menuBottom > menuTop) {
      const capsuleGap = Math.max(4, menuTop - statusBarHeight)
      return Math.ceil(menuBottom + capsuleGap)
    }
  }
  catch {
    // Some desktop/runtime versions do not expose capsule geometry. The
    // current window API remains the source of truth for the status bar.
  }

  return Math.ceil(statusBarHeight + 44)
}
