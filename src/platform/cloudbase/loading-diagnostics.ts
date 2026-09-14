export type LoadingStage = 'events.request' | 'identity.request' | 'identity.response' | 'opportunities.request' | 'opportunities.response' | 'banners.request' | 'media.download'

interface LoadingSample {
  stage: LoadingStage
  startedAt: number
  durationMs: number
  succeeded: boolean
  errorCode?: string
}

const samples: LoadingSample[] = []

function safeErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') {
    return undefined
  }
  const value = error as { code?: unknown, errCode?: unknown, errMsg?: unknown }
  const code = value.code ?? value.errCode
  if (typeof code === 'number' && Number.isFinite(code)) {
    return String(code)
  }
  if (typeof code === 'string' && /^(?:[A-Z][A-Z0-9_]{0,63}|-?\d{1,10})$/.test(code)) {
    return code
  }
  // Retain only the numeric SDK code, never its potentially sensitive error message.
  return typeof value.errMsg === 'string' ? value.errMsg.match(/errCode\s*:\s*(-?\d{1,10})\b/)?.[1] : undefined
}

export function recordLoadingFailure(stage: LoadingStage, error: unknown) {
  const errorCode = safeErrorCode(error)
  samples.push({ stage, startedAt: Date.now(), durationMs: 0, succeeded: false, ...(errorCode ? { errorCode } : {}) })
  if (samples.length > 100) {
    samples.shift()
  }
}

/** Local bounded timings only: never retain request arguments, user data or file URLs. */
export async function measureLoading<T>(stage: LoadingStage, run: () => Promise<T>): Promise<T> {
  const startedAt = Date.now()
  let succeeded = false
  let errorCode: string | undefined
  try {
    const result = await run()
    succeeded = true
    return result
  }
  catch (error) {
    errorCode = safeErrorCode(error)
    throw error
  }
  finally {
    samples.push({ stage, startedAt, durationMs: Math.max(0, Date.now() - startedAt), succeeded, ...(errorCode ? { errorCode } : {}) })
    if (samples.length > 100) {
      samples.shift()
    }
  }
}

export function getLoadingDiagnostics() {
  return samples.map(sample => ({ ...sample }))
}

export function clearLoadingDiagnostics() {
  samples.length = 0
}
