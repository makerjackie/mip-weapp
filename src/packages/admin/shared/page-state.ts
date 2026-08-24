import { MipAdminError } from '../../../modules/mip-admin'

export type AdminPageState = 'loading' | 'ready' | 'error' | 'forbidden' | 'conflict'

const VERSION_CONFLICT_CODES = new Set(['CONFLICT', 'EVENT_VERSION_CONFLICT', 'BRANCH_VERSION_CONFLICT'])

export function isAdminForbiddenError(error: unknown): boolean {
  return error instanceof MipAdminError && error.code === 'FORBIDDEN'
}

export function isAdminVersionConflict(error: unknown): boolean {
  return error instanceof MipAdminError && VERSION_CONFLICT_CODES.has(error.code)
}

/**
 * Map a cold-load failure into a public page state.
 * Background refresh failures keep existing ready content and only set message.
 */
export function adminLoadFailure(
  error: unknown,
  options: { hasContent: boolean, fallbackMessage: string },
): { state?: AdminPageState, message: string } {
  if (options.hasContent) {
    return {
      message: options.fallbackMessage.includes('已保留')
        ? options.fallbackMessage
        : `${options.fallbackMessage}，已保留上次结果。`,
    }
  }
  if (isAdminForbiddenError(error)) {
    return {
      state: 'forbidden',
      message: '当前账号没有运营权限',
    }
  }
  if (isAdminVersionConflict(error)) {
    return {
      state: 'conflict',
      message: '记录状态已变化，请刷新后重试',
    }
  }
  return {
    state: 'error',
    message: error instanceof Error ? error.message : options.fallbackMessage,
  }
}
