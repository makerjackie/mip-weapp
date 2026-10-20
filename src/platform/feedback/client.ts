function publicFeedbackMessage(error: unknown, fallback: string) {
  const message = error instanceof Error
    ? error.message.trim()
    : typeof error === 'string' ? error.trim() : ''
  return message || fallback
}

export function showErrorFeedback(error: unknown, fallback = '操作失败，请稍后重试。') {
  const message = publicFeedbackMessage(error, fallback)
  wx.showToast({
    title: message,
    icon: 'none',
    duration: 3000,
  })
  return message
}

// MIW-126：支付拉起全程（身份检查→下单→取调起参数→收银台）统一全屏 loading，
// tap 即刻出现，收银台原生层接管或流程结束（成功跳转/取消/失败）时收起。
// mask 同时是页面闩锁之外的系统级防双击兜底。
export function showPaymentLaunchFeedback() {
  wx.showLoading({ title: '正在拉起支付…', mask: true })
}

export function hidePaymentLaunchFeedback() {
  // noConflict（基础库 ≥ 2.22.1，工程 pin 3.15.2）：toast 与 loading 各自独立视图，
  // 收 loading 不会连带关掉 toast（Android 混用视图的历史坑）。支付成功路径仍保持
  // 「先收 loading 再弹 toast」的顺序，作为旧基础库下的兜底。
  wx.hideLoading({ noConflict: true })
}
