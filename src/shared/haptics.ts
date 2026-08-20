/**
 * Gives primary navigation a subtle native selection response.
 * Haptics are progressive enhancement: unsupported devices keep navigating.
 */
export function selectionHaptic() {
  if (typeof wx.vibrateShort !== 'function') {
    return
  }
  wx.vibrateShort({ type: 'light', fail: () => undefined })
}
