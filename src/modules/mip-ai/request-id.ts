import { createIntentKey } from '../mip-shell/presentation'

export function createAiDraftRequestSlot(
  prefix: 'ai-draft-text' | 'ai-draft-upload',
  createId = () => createIntentKey(prefix),
) {
  let requestId = ''
  return {
    current() {
      requestId ||= createId()
      return requestId
    },
    matches(value: string) {
      return requestId === value
    },
    rotate() {
      requestId = ''
    },
  }
}

export function shouldRetainAiDraftRequest(error: unknown) {
  const code = (error as { code?: unknown } | null)?.code
  return code === 'SERVICE_UNAVAILABLE'
    || code === 'AI_DRAFT_REQUEST_IN_PROGRESS'
    || code === 'AI_PROVIDER_RESULT_UNKNOWN'
    || code === 'AI_AUDIO_UPLOAD_RESULT_UNKNOWN'
}
