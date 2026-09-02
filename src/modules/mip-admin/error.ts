export class MipAdminError extends Error {
  readonly code: string
  readonly retryable: boolean
  readonly details: Record<string, unknown> | null

  constructor(code: string, message: string, retryable = false, details: Record<string, unknown> | null = null) {
    super(message)
    this.name = 'MipAdminError'
    this.code = code
    this.retryable = retryable
    this.details = details
  }
}
