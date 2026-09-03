export class MipOpportunityError extends Error {
  readonly code: string
  readonly retryable: boolean
  readonly resultUnknown: boolean

  constructor(code: string, message: string, retryable = false, resultUnknown = false) {
    super(message)
    this.name = 'MipOpportunityError'
    this.code = code
    this.retryable = retryable
    this.resultUnknown = resultUnknown
  }
}
