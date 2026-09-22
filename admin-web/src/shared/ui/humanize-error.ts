/**
 * Maps server error codes and raw error messages to human-readable Chinese text.
 * Used by AdminOperationProvider and any async feedback path.
 */

const ERROR_CODE_MAP: Record<string, string> = {
  VERSION_CONFLICT: '记录已被其他人更新，请刷新后重试',
  CONFLICT: '记录状态已变化，请刷新后重试',
  FORBIDDEN: '当前账号没有执行此操作的权限',
  UNAUTHORIZED: '登录已过期，请重新登录',
  NOT_FOUND: '记录不存在或已被删除',
  VALIDATION_ERROR: '提交内容不符合要求，请检查字段',
  RATE_LIMITED: '操作过于频繁，请稍后再试',
  INTERNAL_ERROR: '服务暂时不可用，请稍后重试',
  NETWORK_ERROR: '网络连接失败，请检查网络后重试',
}

const ERROR_PATTERN_MAP: Array<{ pattern: RegExp; message: string }> = [
  { pattern: /timeout|timed?\s*out/i, message: '请求超时，请重试' },
  { pattern: /network|fetch|ERR_INTERNET/i, message: '网络连接失败，请检查网络后重试' },
  { pattern: /403|forbidden/i, message: '当前账号没有执行此操作的权限' },
  { pattern: /401|unauthorized/i, message: '登录已过期，请重新登录' },
  { pattern: /404|not\s*found/i, message: '记录不存在或已被删除' },
  { pattern: /500|internal\s*server/i, message: '服务暂时不可用，请稍后重试' },
  { pattern: /version|conflict/i, message: '记录已被其他人更新，请刷新后重试' },
]

export function humanizeError(reason: unknown): string {
  if (!reason) return '请求结果暂时无法确认'
  if (reason instanceof Error) return humanizeMessage(reason.message)
  if (typeof reason === 'string') return humanizeMessage(reason)
  if (typeof reason === 'object' && 'code' in reason) {
    const code = String((reason as { code: unknown }).code)
    if (ERROR_CODE_MAP[code]) return ERROR_CODE_MAP[code]
    const message = (reason as { message?: unknown }).message
    if (typeof message === 'string') return humanizeMessage(message)
  }
  return '请求结果暂时无法确认'
}

function humanizeMessage(message: string): string {
  if (!message) return '请求结果暂时无法确认'
  const codeMatch = ERROR_CODE_MAP[message]
  if (codeMatch) return codeMatch
  for (const { pattern, message: humanized } of ERROR_PATTERN_MAP) {
    if (pattern.test(message)) return humanized
  }
  return message
}
