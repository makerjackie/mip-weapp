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
