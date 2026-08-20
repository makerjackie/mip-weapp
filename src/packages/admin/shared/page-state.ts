import { AdminGatewayError } from '../../../modules/admin/cloudbase-gateway'

export type AdminPageState = 'loading' | 'ready' | 'error' | 'forbidden'

export function isAdminForbiddenError(error: unknown): boolean {
  return error instanceof AdminGatewayError && error.code === 'FORBIDDEN'
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
  return {
    state: 'error',
    message: error instanceof Error ? error.message : options.fallbackMessage,
  }
}

export function isAdminVersionConflict(error: unknown): boolean {
  return error instanceof AdminGatewayError
    && (error.code === 'EVENT_VERSION_CONFLICT' || error.code === 'REGISTRATION_VERSION_CONFLICT')
}
