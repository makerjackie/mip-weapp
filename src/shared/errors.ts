export class AppError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'AppError'
    this.code = code
  }
}

export function errorMessage(error: unknown, fallback = '操作失败') {
  if (error instanceof Error && error.message.trim()) {
    return error.message
  }
  return fallback
}

export function sanitizeLogText(value: string) {
  return value
    .replace(/wx[0-9a-f]{16}/gi, '[redacted-appid]')
    .replace(/mysql:\/\/[^\s"']+/gi, 'mysql://[redacted]')
    .replace(/(Bearer\s+)[\w.~-]+/gi, '$1[redacted]')
    .replace(/("(?:api[_-]?key|secret|token|password|private[_-]?key)"\s*:\s*")[^"]+("?)/gi, '$1[redacted]$2')
}
