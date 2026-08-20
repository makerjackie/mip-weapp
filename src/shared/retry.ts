export interface RetryOptions {
  attempts: number
  delaysMs?: number[]
}

/** Keep this policy for idempotent reads only; business writes remain single-shot. */
export const COLD_START_READ_RETRY: RetryOptions = {
  attempts: 5,
  delaysMs: [250, 700, 1_400, 2_500],
}

function delay(milliseconds: number) {
  if (milliseconds <= 0) {
    return Promise.resolve()
  }
  return new Promise(resolve => setTimeout(resolve, milliseconds))
}

/** Retries transport failures only. Parse business envelopes after this function returns. */
export async function retryTransport<T>(operation: () => Promise<T>, options: RetryOptions): Promise<T> {
  const attempts = Math.max(1, Math.floor(options.attempts))
  let lastError: unknown
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await operation()
    }
    catch (error) {
      lastError = error
      if (attempt + 1 >= attempts) {
        break
      }
      await delay(options.delaysMs?.[attempt] ?? 0)
    }
  }
  throw lastError
}
